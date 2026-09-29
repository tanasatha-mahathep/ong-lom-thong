import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AppForm, SubmitButton } from "@/components/app-form";
import { BrandMark } from "@/components/brand-mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { PasswordField, TextField } from "@/components/ui/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAppForm } from "@/hooks/use-app-form";
import { errorMessage } from "@/lib/api";
import { type Me, canSwitchBranch, meQueryOptions } from "@/lib/queries";
import { signIn, signInErrorMessage, switchBranch } from "@/lib/session";

/**
 * login-04 ของ shadcn ปรับเป็นสองขั้นในการ์ดเดียว:
 * 1) อีเมล + รหัสผ่าน  2) เลือกสาขาที่ทำงาน (เฉพาะบัญชีที่มีสิทธิ์มากกว่า 1 สาขา)
 * ไม่มี social login / สมัครเอง (ปิดที่เซิร์ฟเวอร์) · คีย์บอร์ดล้วน: โฟกัสอีเมลเอง · Enter = ส่ง
 * หน้าอ้างอิงของกฎฟอร์ม U0–U6: useAppForm · TextField/PasswordField · toast · ชั้นบังหน้าจอตอนพาเข้าแอป (`onDone`)
 */
export function LoginForm({ onDone }: { onDone: () => Promise<void> | void }) {
  const [me, setMe] = useState<Me | null>(null);

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="grid p-0 md:grid-cols-2">
        {me ? (
          <BranchStep me={me} onDone={onDone} />
        ) : (
          <SignInStep onSignedIn={(signedIn) => (canSwitchBranch(signedIn) ? setMe(signedIn) : onDone())} />
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

function SignInStep({ onSignedIn }: { onSignedIn: (me: Me) => Promise<void> | void }) {
  const { t } = useTranslation("auth");
  const queryClient = useQueryClient();
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, t("signIn.missingEmail"))
          .pipe(z.email(t("signIn.invalidEmail"))),
        password: z.string().min(1, t("signIn.missingPassword")),
      }),
    [t],
  );

  const f = useAppForm({
    defaultValues: { email: "", password: "" },
    schema,
    submit: async ({ email, password }): Promise<Me> => {
      // email มาจาก schema.parse แล้ว (trim + ตรวจรูปแบบ) — ส่งตรงได้
      await signIn({ email, password });
      // session ใหม่ — ทิ้ง cache ของ session ก่อนหน้า แล้วอ่านผู้ใช้จากเซิร์ฟเวอร์
      queryClient.removeQueries();
      const me = await queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
      // มีสิทธิ์สาขาเดียวแต่ session ยังไม่มีสาขา (สาขาหลักถูกปิด / สร้างแบบ allow) → ตั้งให้เลย ไม่ต้องถาม
      const [only] = me.branches;
      if (me.branch || !only || me.branches.length > 1) return me;
      const branch = await switchBranch(only.id);
      const withBranch = { ...me, branch };
      queryClient.setQueryData(meQueryOptions.queryKey, withBranch);
      return withBranch;
    },
    // ยังต้องเลือกสาขา = ยังไม่ต้อนรับ (ต้อนรับตอนเข้าแอปจริง)
    successMessage: (me) => (canSwitchBranch(me) ? undefined : t("signIn.welcome", { name: me.user.name })),
    onSuccess: onSignedIn,
    // 401 = รหัสผิด (ไม่ใช่ session หมดอายุ — sign-in ไม่ผ่านตัวดัก 401 กลางเพราะไม่ใช่ useMutation)
    // better-auth ไม่ชี้ช่อง → ข้อความรวมเหนือช่อง + toast · เลือกรหัสผ่านไว้ให้พิมพ์ใหม่
    errorMessage: (error) => signInErrorMessage(error, window.location.origin),
    fieldOfError: () => undefined,
    focusOnFormError: "password",
  });

  const formErrorId = f.fieldId("form-error");
  const describedBy = f.formError ? formErrorId : undefined;

  return (
    <AppForm form={f} className="p-6 md:p-8">
      <FieldGroup className="gap-5">
        <StepHeading
          title={t("signIn.title")}
          description={t("signIn.description", { shop: t("shopName", { ns: "common" }) })}
        />
        {f.formError && <FormAlert id={formErrorId} message={f.formError} />}
        <f.form.Field name="email">
          {(field) => (
            <TextField
              {...f.bind(field)}
              label={t("signIn.email")}
              placeholder={t("signIn.emailPlaceholder")}
              type="email"
              inputMode="email"
              autoComplete="username"
              spellCheck={false}
              autoFocus
              required
              aria-invalid={f.formError ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </f.form.Field>
        <f.form.Field name="password">
          {(field) => (
            <PasswordField
              {...f.bind(field)}
              label={t("signIn.password")}
              placeholder={t("signIn.passwordPlaceholder")}
              autoComplete="current-password"
              required
              aria-invalid={f.formError ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </f.form.Field>
        <Field>
          <SubmitButton form={f} size="lg" pendingLabel={t("signIn.submitting")}>
            {t("signIn.submit")}
          </SubmitButton>
          <FieldDescription className="text-center">{t("signIn.help")}</FieldDescription>
        </Field>
      </FieldGroup>
    </AppForm>
  );
}

function BranchStep({ me, onDone }: { me: Me; onDone: () => Promise<void> | void }) {
  const { t } = useTranslation("auth");
  const queryClient = useQueryClient();
  // ค่าเริ่มต้น = สาขาปัจจุบันของ session (สาขาหลักของบัญชี)
  const [initialId] = useState(() => me.branch?.id ?? me.branches[0]?.id ?? "");

  const schema = useMemo(() => z.object({ branchId: z.string().min(1, t("branch.required")) }), [t]);
  const f = useAppForm({
    defaultValues: { branchId: initialId },
    // ไม่มีสาขาที่เลือก = ไม่ส่ง ไม่ว่าจะมาจาก Enter · Ctrl+Enter หรือปุ่ม
    schema,
    submit: ({ branchId }) => switchBranch(branchId),
    successMessage: (branch) => t("branch.welcome", { name: me.user.name, branch: branch.name }),
    onSuccess: async (branch) => {
      queryClient.setQueryData(meQueryOptions.queryKey, { ...me, branch });
      await onDone();
    },
    errorMessage: (error) => t("branch.saveFailed", { reason: errorMessage(error) }),
    fieldOfError: () => undefined,
  });
  const ids = f.fieldId("branch");
  const formErrorId = `${ids}-form-error`;

  // radio ของ Radix ไม่ส่งฟอร์มเมื่อกด Enter — ส่งเองให้คีย์บอร์ดจบได้ในปุ่มเดียว
  const submitOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    // ยังไม่ได้เลือกสาขา = ปุ่มบันทึกปิดอยู่ · Enter ต้องไม่ข้ามเงื่อนไขนั้น
    if (!f.form.state.values.branchId) return;
    f.submit();
  };

  return (
    <AppForm form={f} className="p-6 md:p-8">
      <FieldGroup>
        <StepHeading
          title={t("branch.title")}
          description={t("branch.greeting", { name: me.user.name, count: me.branches.length })}
        />
        {f.formError && <FormAlert id={formErrorId} message={f.formError} />}
        <FieldSet>
          <FieldLegend variant="label">{t("branch.legend")}</FieldLegend>
          <f.form.Field name="branchId">
            {(field) => (
              <RadioGroup
                name={field.name}
                value={field.state.value}
                onValueChange={field.handleChange}
                onKeyDown={submitOnEnter}
                aria-describedby={f.formError ? formErrorId : undefined}
              >
                {me.branches.map((branch) => {
                  const id = `${ids}-${branch.id}`;
                  return (
                    <FieldLabel key={branch.id} htmlFor={id}>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldTitle id={`${id}-name`}>{branch.name}</FieldTitle>
                          <FieldDescription id={`${id}-code`} className="tabular-nums">
                            {t("branchCode", { ns: "common", code: branch.code })}
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
            )}
          </f.form.Field>
          <FieldDescription>{t("branch.hint")}</FieldDescription>
        </FieldSet>
        <Field>
          <f.form.Subscribe selector={(state) => state.values.branchId}>
            {(branchId) => (
              <SubmitButton form={f} size="lg" disabled={!branchId}>
                {t("branch.submit")}
              </SubmitButton>
            )}
          </f.form.Subscribe>
        </Field>
      </FieldGroup>
    </AppForm>
  );
}

/** แทนรูปของ login-04 — วาดด้วย CSS + SVG ล้วน (ไม่มีไฟล์รูปภายนอก) · สีแบรนด์ตายตัว (พื้นเข้มทองเหมือนกันทั้งสองธีม) */
function BrandPanel() {
  const { t } = useTranslation("auth");
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
        <p className="text-4xl leading-tight font-bold text-amber-100">{t("shopName", { ns: "common" })}</p>
        <p className="text-lg text-neutral-300">{t("brandTagline")}</p>
      </div>
    </div>
  );
}
