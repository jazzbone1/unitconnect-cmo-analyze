# Cloudflare 이전 가이드

현재 앱은 브라우저 `localStorage`에 현장(프로젝트)을 저장합니다. 아래 절차로
**Cloudflare Pages + KV** 로 옮기면 여러 기기·여러 사용자가 같은 데이터를
공유하고 백업할 수 있습니다.

앱 코드는 이미 저장소가 추상화되어 있어(`src/lib/store.ts`), 환경변수만
바꾸면 원격 저장소로 전환됩니다.

## 개인정보 관련 (중요)

- **명부(사용자 정보)는 업로드 시점에 개인정보가 제거**됩니다
  (`sanitizeRegistry`): 이름·건물명·동·호·전화·스마트카드·이메일 제거,
  차량번호·차종만 유지(차량번호는 중복제거용이며 화면에는 표시하지 않음).
- 따라서 Cloudflare(KV)에는 **이름·연락처가 저장되지 않습니다.**
- 그래도 차량번호는 남으므로, 운영 시 **Cloudflare Access 로그인**으로 접근을
  제한하는 것을 권장합니다.

## 1. 사전 준비

```bash
npm i -g wrangler        # 또는 npx 사용
wrangler login
```

## 2. KV 네임스페이스 생성

```bash
npx wrangler kv namespace create PROJECTS
```

출력된 `id` 를 `wrangler.toml` 의 `REPLACE_WITH_KV_NAMESPACE_ID` 자리에 붙여넣습니다.

## 3. Pages 프로젝트 연결

- Cloudflare 대시보드 → **Workers & Pages → Create → Pages → Connect to Git**
- 이 저장소를 선택
- 빌드 설정:
  - Build command: `npm run build`
  - Build output directory: `dist`
- **환경변수(빌드)** 에 추가:
  - `VITE_REMOTE_STORE = 1`
  - (같은 도메인에 API가 있으므로 `VITE_API_BASE` 는 비워둠)
- KV 바인딩: Settings → Functions → KV namespace bindings 에서
  변수명 `PROJECTS` 로 위에서 만든 네임스페이스를 연결

`functions/api/projects.ts` 가 자동으로 `/api/projects` 엔드포인트가 됩니다
(GET=목록, PUT=전체 저장).

## 4. (권장) 접근 제어

Cloudflare **Zero Trust → Access → Applications** 에서 이 Pages 도메인을
보호하면, 로그인한 이메일별로 데이터가 분리 저장됩니다
(`cf-access-authenticated-user-email` 헤더 사용).

## 로컬 개발에서 원격 붙여 테스트

```bash
# .env.local
VITE_REMOTE_STORE=1
VITE_API_BASE=

npx wrangler pages dev -- npm run dev   # 또는 wrangler pages dev dist
```

## 확장(다음 단계)

- **원본 파일(엑셀·PDF)까지 보관**하려면 KV 대신 **R2**(객체 저장)에 파일을,
  메타데이터는 **D1**(SQLite)에 저장하도록 API를 확장할 수 있습니다.
- 현재 스캐폴드는 프로젝트 목록 전체를 KV 한 키에 JSON으로 저장하는
  단순 구조입니다(수백 현장 규모까지 충분). 규모가 더 커지면 프로젝트별
  행 저장(D1)으로 나누는 것을 권장합니다.
