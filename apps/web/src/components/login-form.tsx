import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorMessage } from "@/lib/api";
import { type Me, meQueryOptions } from "@/lib/queries";
import { SHOP_NAME } from "@/lib/shop";
import { signIn, signInErrorMessage, switchBranch } from "@/lib/session";

/**
 * login-04 ของ shadcn ปรับเป็นสองขั้นในการ์ดเดียว:
 * 1) อีเมล + รหัสผ่าน  2) เลือกสาขาที่ทำงาน (เฉพาะบัญชีที่มีสิทธิ์มากกว่า 1 สาขา)
 * ไม่มี social login / สมัครเอง (ปิดที่เซิร์ฟเวอร์) · คีย์บอร์ดล้วน: โฟกัสอีเมลเอง · Enter = ส่ง
 */
export function LoginForm({ onDone }: { onDone: () => void }) {
  const [me, setMe] = useState<Me | null>(null);

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="grid p-0 md:grid-cols-2">
        {me ? (
          <BranchStep me={me} onDone={onDone} />
        ) : (
          <SignInStep onSignedIn={(signedIn) => (signedIn.branches.length > 1 ? setMe(signedIn) : onDone())} />
        )}
        <BrandPanel />
      </CardContent>
    </Card>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <BrandMark className="size-12 md:hidden" />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-balance text-muted-foreground">{description}</p>
    </div>
  );
}

function FormAlert({ id, message }: { id: string; message: string }) {
  return (
    <Alert id={id} variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}

type FieldErrors = { email?: string; password?: string };

function SignInStep({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      await signIn(credentials);
      // session ใหม่ — ทิ้ง cache ของ session ก่อนหน้า แล้วอ่านผู้ใช้จากเซิร์ฟเวอร์
      queryClient.removeQueries();
      return queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
    },
    // 401 = รหัสผิด แสดงในฟอร์ม ไม่ใช่ session หมดอายุ
    meta: { handlesUnauthorized: true },
    onSuccess: onSignedIn,
    onError: () => passwordRef.current?.select(),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const email = read("email").trim();
    const password = read("password");
    const errors: FieldErrors = {
      ...(email ? {} : { email: "กรอกอีเมล" }),
      ...(password ? {} : { password: "กรอกรหัสผ่าน" }),
    };
    setFieldErrors(errors);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();
    mutation.mutate({ email, password });
  };

  const formError = mutation.isError ? signInErrorMessage(mutation.error, window.location.origin) : null;
  const describedBy = (field: keyof FieldErrors) =>
    [fieldErrors[field] && `${ids}-${field}-error`, formError && `${ids}-form-error`].filter(Boolean).join(" ") ||
    undefined;

  return (
    <form noValidate onSubmit={submit} className="p-6 md:p-8">
      <FieldGroup>
        <StepHeading title="เข้าสู่ระบบ" description={`บัญชีพนักงานร้าน${SHOP_NAME}`} />
        {formError && <FormAlert id={`${ids}-form-error`} message={formError} />}
        <Field data-invalid={!!fieldErrors.email}>
          <FieldLabel htmlFor={`${ids}-email`}>อีเมล</FieldLabel>
          <Input
            ref={emailRef}
            id={`${ids}-email`}
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            aria-invalid={!!fieldErrors.email || !!formError}
            aria-describedby={describedBy("email")}
          />
          <FieldError id={`${ids}-email-error`}>{fieldErrors.email}</FieldError>
        </Field>
        <Field data-invalid={!!fieldErrors.password}>
          <FieldLabel htmlFor={`${ids}-password`}>รหัสผ่าน</FieldLabel>
          <Input
            ref={passwordRef}
            id={`${ids}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={!!fieldErrors.password || !!formError}
            aria-describedby={describedBy("password")}
          />
          <FieldError id={`${ids}-password-error`}>{fieldErrors.password}</FieldError>
        </Field>
        <Field>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </Button>
          <FieldDescription className="text-center">ลืมรหัสผ่านหรือยังไม่มีบัญชี ติดต่อผู้ดูแลระบบ</FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}

function BranchStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // ค่าเริ่มต้น = สาขาปัจจุบันของ session (สาขาหลักของบัญชี)
  const [initialId] = useState(() => me.branch?.id ?? me.branches[0]?.id ?? "");
  const [branchId, setBranchId] = useState(initialId);

  const mutation = useMutation({
    mutationFn: switchBranch,
    onSuccess: (branch) => {
      queryClient.setQueryData(meQueryOptions.queryKey, { ...me, branch });
      onDone();
    },
  });

  // radio ของ Radix ไม่ส่งฟอร์มเมื่อกด Enter — ส่งเองให้คีย์บอร์ดจบได้ในปุ่มเดียว
  const submitOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  const formError = mutation.isError ? `บันทึกสาขาไม่สำเร็จ — ${errorMessage(mutation.error)}` : null;

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(branchId);
      }}
      className="p-6 md:p-8"
    >
      <FieldGroup>
        <StepHeading
          title="เลือกสาขาที่ทำงาน"
          description={`สวัสดี ${me.user.name} — บัญชีนี้ใช้ได้ ${me.branches.length} สาขา`}
        />
        {formError && <FormAlert id={`${ids}-form-error`} message={formError} />}
        <FieldSet>
          <FieldLegend variant="label">สาขาสำหรับบิลและรายงานในรอบนี้</FieldLegend>
          <RadioGroup
            value={branchId}
            onValueChange={setBranchId}
            onKeyDown={submitOnEnter}
            aria-describedby={formError ? `${ids}-form-error` : undefined}
          >
            {me.branches.map((branch) => {
              const id = `${ids}-${branch.id}`;
              return (
                <FieldLabel key={branch.id} htmlFor={id}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle id={`${id}-name`}>{branch.name}</FieldTitle>
                      <FieldDescription id={`${id}-code`} className="tabular-nums">
                        รหัสสาขา {branch.code}
                      </FieldDescription>
                    </FieldContent>
                    {/* radio ของ Radix เป็น <button> — label[for] ไม่ถูกนับเป็นชื่อในเครื่องมือตรวจ จึงผูกชื่อตรง ๆ */}
                    <RadioGroupItem
                      id={id}
                      value={branch.id}
                      aria-labelledby={`${id}-name`}
                      aria-describedby={`${id}-code`}
                      autoFocus={branch.id === initialId}
                    />
                  </Field>
                </FieldLabel>
              );
            })}
          </RadioGroup>
          <FieldDescription>เปลี่ยนภายหลังได้ที่เมนูผู้ใช้ท้ายแถบเมนู</FieldDescription>
        </FieldSet>
        <Field>
          <Button type="submit" disabled={mutation.isPending || !branchId}>
            {mutation.isPending ? "กำลังบันทึก…" : "เข้าใช้งาน"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}

/** แทนรูปของ login-04 — วาดด้วย CSS + SVG ล้วน (ไม่มีไฟล์รูปภายนอก) */
function BrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between gap-10 overflow-hidden bg-neutral-950 p-10 text-neutral-50 md:flex">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_85%_10%,rgb(220_174_72/0.32),transparent_65%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.035)_0_1px,transparent_1px_14px)]"
      />
      <BrandMark className="relative size-16 ring-1 ring-amber-200/20" />
      <div className="relative space-y-3">
        <p className="text-4xl leading-tight font-bold text-amber-100">{SHOP_NAME}</p>
        <p className="text-lg text-neutral-300">ระบบซื้อเข้าหน้าร้าน · สมาชิก</p>
      </div>
    </div>
  );
}
