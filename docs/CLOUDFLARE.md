# Cloudflare 공용 저장소 연결 (Railway 호스팅 + Cloudflare Worker)

현재 구성:
- **프론트엔드**: Railway (`https://...up.railway.app`)
- **저장**: 기본은 브라우저 localStorage

아래처럼 **Cloudflare Worker + KV** 를 붙이면, 사이트에 접속하는 모든 사람이
**하나의 공용 저장소**에서 같은 현장·분석 데이터를 보고 저장하게 됩니다.

```
[Railway 앱] --(fetch /api/projects)--> [Cloudflare Worker] --> [KV 저장소]
```

## 개인정보

- 명부(사용자 정보)는 업로드 시점에 개인정보가 제거된 뒤 저장됩니다
  (이름·건물·동·호·전화·스마트카드·이메일 제거, 차량번호·차종만 유지).
- 따라서 Cloudflare KV에는 **이름·연락처가 저장되지 않습니다.**

## 1. Worker 배포 (Cloudflare)

```bash
cd worker
npm install
npx wrangler login

# KV 네임스페이스 생성 → 출력된 id 를 worker/wrangler.toml 의
# REPLACE_WITH_KV_NAMESPACE_ID 자리에 붙여넣기
npx wrangler kv namespace create PROJECTS

# 배포
npx wrangler deploy
```

배포가 끝나면 Worker 주소가 나옵니다. 예:
`https://unitconnect-cmo-store.<계정이름>.workers.dev`

## 2. Railway 앱을 Worker에 연결

Railway → 이 서비스 → **Variables** 에 추가:

| 변수 | 값 |
|------|-----|
| `VITE_REMOTE_STORE` | `1` |
| `VITE_API_BASE` | `https://unitconnect-cmo-store.<계정>.workers.dev` |

저장하면 Railway가 **자동 재빌드**합니다. (환경변수는 빌드 시 앱에 주입됩니다.)

이제 어느 브라우저·기기에서 접속해도 같은 데이터를 보고, 저장하면 모두에게
반영됩니다.

## 3. (선택) 아무나 못 쓰게 막기 — 공유 키

공용 저장소를 완전히 열어두면 주소를 아는 누구나 읽기/쓰기가 가능합니다.
간단히 막으려면 공유 키를 씁니다.

- `worker/wrangler.toml` 의 `[vars] AUTH_KEY = "정한값"` 주석 해제 후 재배포
  (또는 `npx wrangler secret put AUTH_KEY`)
- Railway Variables 에 `VITE_APP_KEY = 정한값` (Worker AUTH_KEY와 동일) 추가 후 재빌드

> 주의: 프론트엔드에 넣는 키라 브라우저에서 볼 수는 있어 "완전한 보안"은
> 아니지만, 무작위 접근·봇은 막아줍니다. 강한 보안이 필요하면 로그인(Access)
> 방식으로 확장하세요.

## 동작 방식 (참고)

- Worker API: `GET /api/projects`(목록), `PUT /api/projects`(전체 저장)
- 저장 단위: 프로젝트 배열 전체를 KV 한 키(`projects:shared`)에 JSON으로 저장
  (수백 현장 규모까지 충분)
- 앱의 저장소 전환 지점: `src/lib/store.ts` (환경변수로 local ↔ remote)

## 로컬에서 원격 붙여 테스트

```bash
# .env.local
VITE_REMOTE_STORE=1
VITE_API_BASE=https://unitconnect-cmo-store.<계정>.workers.dev

npm run dev
```
