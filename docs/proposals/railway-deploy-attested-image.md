# Proposal: Railway deploys the attested image, not a rebuild

Status: proposal, for the backend session to apply **after 1.0.0**. Nothing in `.railway/railway.ts` changes
in the PR that adds this file.
Written 2026-09-29 alongside the `ci/ghcr-provenance` branch.

## 1. Problem

Railway builds `apps/api/Dockerfile` and `services/gotenberg/Dockerfile` from source (`github(REPO, …)` in
`.railway/railway.ts`). CI builds the same Dockerfiles, then smokes, scans (Trivy) and runs e2e against its own
build. Two builds from the same commit are **not the same bytes**:

- base images are pinned by digest, but `apt-get` / `pnpm` resolve at build time. Gotenberg now runs
  `apt-get upgrade` (section 4), so a rebuild a day later can contain a different Chromium.
- the Railway build runs on infrastructure CI never sees, so there is no provenance for what runs in production.

So the tested bytes and the deployed bytes can differ. SLSA Build L2 requires signed provenance produced by
the build platform for the artifact that is actually deployed.

## 2. What CI does now (this branch)

In the ring-1 `image` job of `ci.yml` (push to `testing` / `staging` / `main`, and `workflow_dispatch`):

1. build the api image once, then smoke it, generate the CycloneDX SBOM, run the Trivy gate, and hand the tar to e2e (unchanged)
2. build the Gotenberg image, then generate its SBOM and run the Trivy gate (`scripts/ci/gotenberg-scan.sh`)
3. once both gates pass, push the **same local images** (no rebuild) to
   `ghcr.io/tanasatha-mahathep/ong-lom-thong/{api,gotenberg}` with the tags `<full commit sha>` and `<branch>`
   (`scripts/ci/push-image.sh`)
4. `actions/attest` (the action that `attest-build-provenance` and `attest-sbom` now wrap) signs SLSA v1
   provenance and the SBOM for each **digest**. Signing goes through Sigstore with the job's OIDC identity, and
   the attestation is pushed to the registry as an OCI referrer.

The job has the only write permissions in the workflow (`packages`, `id-token`, `attestations`), and it
uses no cache.

Verify anywhere with:

```sh
make verify-image REF=<commit sha>             # api + gotenberg · provenance + SBOM · signer = ci.yml
make verify-image REF=sha256:<digest> IMAGES=api
```

`verify-image` pins the signer workflow (`--signer-workflow …/ci.yml`) and rejects self-hosted runners, so an
attestation from any other workflow or fork does not pass.

## 3. How Railway should deploy

Railway pulls an image; it cannot verify a Sigstore attestation before it pulls. A pre-deploy command runs
_inside_ the image it would be checking, which proves nothing. So **CI verifies, then points Railway at a
digest**:

1. **Make the GHCR packages public** (repo is public): Package settings → Change visibility → Public, for `api`
   and `gotenberg`. This avoids storing registry credentials in Railway. If they must stay private, use a
   fine-grained PAT with `read:packages` only, set as `registryCredentials` in `DeployConfig`.
2. **Switch the sources in `.railway/railway.ts`** from `github(REPO, …)` to `image(…)`, with
   `autoUpdates` **off**, so Railway never follows a moving tag:

   ```ts
   // placeholder: CI replaces the digest on every deploy (step 3); a tag here would reopen the gap
   source: image("ghcr.io/tanasatha-mahathep/ong-lom-thong/api@sha256:<digest>"),
   ```

   Drop `build.watchPatterns` for those services. Keep `preDeploy` (migrations) and the healthchecks: they run
   inside the image as they do today.

3. **Add a `deploy-<env>` job to `ci.yml`**, with `needs: [image, e2e, sca]`, only on push to `staging` / `main`,
   and a `deployments: write`-free token: a Railway project token in a GitHub Environment secret with required
   reviewers for production. It:
   - runs `scripts/ci/verify-image.sh sha256:<api digest> api` and the same for gotenberg (fail = no deploy),
     using the digests from the `image` job outputs, never a tag;
   - updates the service source to `…@sha256:<digest>` and triggers a deploy (Railway CLI or the public GraphQL
     API `serviceInstanceUpdate` + `serviceInstanceDeploy`), Gotenberg first, then api.
     Railway's own "wait for CI" check then no longer matters for these services. Keep it on while both paths
     exist.
4. **Rollback** means redeploying an earlier digest. `make verify-image REF=<old sha>` still passes, because
   attestations do not expire. GHCR tags by SHA are never overwritten.
5. **Retention**: set a GHCR cleanup policy that keeps every image referenced by a release tag (`v*` commit
   SHAs) and removes untagged or branch-only versions older than 90 days.

Before step 2 the backend session must check that Railway accepts `image@sha256:` references in `image()`.
The SDK types accept any string, but Railway's docs only show tags. If Railway does not accept a digest, use
the SHA tag (immutable by our own convention: `push-image.sh` never rewrites it) and keep the verify step
against the digest.

## 4. Gotenberg: version decision and hardening

### Version

- `gh api repos/gotenberg/gotenberg/releases`: **8.37.0 (2026-09-11) is still the latest release**. The Docker
  Hub tags `8` and `8.37.0` point to the digest we pin. Upstream has nothing to bump to.
- Debian trixie-security already ships **Chromium 154.0.8037.57** (Gotenberg 8.37.0 bundles 152.0.7977.82),
  along with perl `5.40.1-6+deb13u1` and glib `2.84.4-3~deb13u4`. `services/gotenberg/Dockerfile` now runs
  `apt-get upgrade` on top of the pinned base.
- Trivy 0.74.0, measured locally (arm64) on 2026-09-29:

  | Image                                 | CRITICAL (with a fix) | HIGH (with a fix) | MEDIUM | LOW | UNKNOWN |
  | ------------------------------------- | --------------------: | ----------------: | -----: | --: | ------: |
  | `gotenberg/gotenberg:8.37.0` (before) |               26 (25) |         244 (132) |    404 | 334 |     578 |
  | ours + `apt-get upgrade` (after)      |                 1 (0) |           114 (2) |    234 | 324 |      12 |

  The CI runner is amd64, so its counts can differ slightly; the step summary shows the real numbers.

- Checks that passed with the upgraded image: the `pdf` e2e project (15/15), then the full e2e suite (84/84), and
  `apps/api` `gotenberg.test.ts` + `buyPdf.test.ts` against real Gotenberg (45/45).
- Trade-off: `apt-get upgrade` is not reproducible (it takes whatever is in trixie-security at build time).
  With section 3 in place that stops mattering, because the attested digest is what runs. Remove the `RUN`
  line when an upstream release ships a newer Chromium.
- Worth evaluating next: the `8.x-chromium` image variant (no LibreOffice at all). It is a smaller attack surface
  than disabling LibreOffice's routes. Adopting it needs the same e2e + golden checks, and dropping
  `--libreoffice-disable-routes`, which that variant does not know.

### Is Gotenberg the right tool for Thai tax receipts?

| Criterion                       | Gotenberg (Chromium)                                                                        | Playwright / Chromium in the api                                                         | WeasyPrint                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Thai shaping                    | HarfBuzz (Chromium) — tone marks and vowels stack correctly; proven by `thai-a4.spec`       | same engine, same result                                                                 | HarfBuzz via Pango — correct shaping; Thai line breaking needs libthai and is weaker than ICU |
| Same output as `window.print()` | yes, the same Blink layout the cashier sees                                                 | yes                                                                                      | no — its own CSS engine (no flex/grid gaps, partial CSS 3), templates need a second design    |
| Attack surface                  | full browser, isolated in its own container on the private network                          | full browser **inside the api process** that holds DB credentials and card images: worse | small (Python, no JS), but a Python runtime next to a Node stack                              |
| CVE churn                       | high (Chromium); mitigated by the weekly scan + upgrade                                     | same, plus it lands in the api image                                                     | low                                                                                           |
| PDF/A                           | only through LibreOffice, **which drops Thai tone marks** (tested 2026-09-28), so it is off | none natively                                                                            | native PDF/A-1b/2b/3b and PDF/UA                                                              |

Conclusion: for this project Gotenberg is the best-practice choice. The receipt layout is one HTML/CSS
template that must print identically on screen and on paper, and Chromium's Thai rendering is proven against
real receipts. Isolating the browser in a separate, locked-down service is better than embedding Playwright
in the api. WeasyPrint becomes the better choice only if a legal requirement for PDF/A archival appears. It
would mean re-proving every template against real receipts, which is not justified for phase 1.

### Hardening applied (`services/gotenberg/Dockerfile` CMD)

| Control                                  | How                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private network only                     | Railway service has no public domain; api reaches `gotenberg.railway.internal`                                                                                                                                                                                                                              |
| Authentication                           | `--api-enable-basic-auth` (fails to start without credentials); `/health` is the only open route                                                                                                                                                                                                            |
| Only `chromium/convert/html`             | `--libreoffice-disable-routes` `--pdfengines-disable-routes`                                                                                                                                                                                                                                                |
| No outbound fetches (SSRF)               | `--chromium-deny-private-ips` `--chromium-deny-public-ips`: Chromium reaches no host at all. Assets travel inside the multipart form (`file:///tmp/…`); other `file://` paths are blocked by the default `--chromium-deny-list`. `failOnResourceLoadingFailed` fails the receipt if anything tries to load. |
| No server-side fetch / callback features | `--api-disable-download-from` `--webhook-disable`                                                                                                                                                                                                                                                           |
| No script execution                      | `--chromium-disable-javascript` (templates are HTML/CSS only)                                                                                                                                                                                                                                               |
| Runs as non-root                         | `USER gotenberg` after the font install                                                                                                                                                                                                                                                                     |
| Supply chain                             | base pinned by tag + digest; SBOM + Trivy gate on every ring-1 run and weekly; provenance attested                                                                                                                                                                                                          |

`--chromium-allow-list` is deliberately **not** set. Per Gotenberg's docs, a match bypasses the IP deny
checks, so any allow-list pattern would reopen the network.
