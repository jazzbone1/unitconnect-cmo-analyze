# 공용 저장소 연결 (Railway 서버 + Cloudflare R2)

Cloudflare **Workers 없이**, Railway 서버가 **R2에 직접** 저장/조회합니다.
(사이트 접속자 모두가 같은 현장 데이터를 봅니다.)

```
[브라우저] → [Railway 앱 서버 /api/projects] → [R2 버킷 wecha-cmo-analysis]
```

- R2 접근키는 **서버(Railway)에만** 두므로 브라우저에 노출되지 않습니다.
- 명부는 업로드 시 개인정보(이름·전화 등)가 제거된 뒤 저장됩니다.

## 1. R2 API 토큰 만들기 (Cloudflare)

1. Cloudflare 대시보드 → **R2 Object Storage**
2. 오른쪽 **Manage R2 API Tokens**(또는 API → Create API token)
3. **Create API token**
   - Permissions: **Object Read & Write**
   - 대상 버킷: `wecha-cmo-analysis` (또는 전체)
4. 생성 후 표시되는 값 복사(한 번만 보임):
   - **Access Key ID**
   - **Secret Access Key**
5. **Account ID** 도 확인: R2 개요 화면의 S3 endpoint
   `https://<여기가_ACCOUNT_ID>.r2.cloudflarestorage.com` 에서 앞부분,
   또는 대시보드 우측의 Account ID.

## 2. Railway 환경변수 설정

Railway → 서비스 → **Variables** 에 아래 추가:

| 변수 | 값 |
|------|-----|
| `R2_ACCOUNT_ID` | Cloudflare 계정 ID |
| `R2_ACCESS_KEY_ID` | R2 토큰의 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 토큰의 Secret Access Key |
| `R2_BUCKET` | `wecha-cmo-analysis` |
| `VITE_REMOTE_STORE` | `1` |

저장하면 Railway가 **자동 재빌드/재배포** 합니다.
(`VITE_API_BASE` 는 설정하지 않습니다 — 같은 도메인의 `/api` 를 씁니다.)

## 3. 확인

- 서로 다른 브라우저/폰에서 사이트 접속 → 한쪽에서 **현장 저장** →
  다른 쪽 **새로고침** → 똑같이 보이면 성공.
- 안 되면 Railway → **Deployments → View logs** 에서
  `R2 ON` 이 찍혔는지, `/api/projects` 에서 502/503 이 나는지 확인.

## 동작 방식 (참고)

- 서버: `server.mjs` (Express) — 정적 사이트 서빙 + `/api/projects`(GET/PUT)
- 저장: 프로젝트 배열 전체를 R2 객체 하나(`projects.json`)에 저장
- 저장소 전환 지점: `src/lib/store.ts` (환경변수로 local ↔ remote)
- R2 환경변수가 없으면 `/api` 는 비활성 → 앱은 localStorage로 동작(안전)

## (참고) Cloudflare Worker 방식

`worker/` 폴더에는 Worker+R2 방식도 준비돼 있습니다. 다만 계정에서 Workers가
막히는 경우가 있어, 기본은 위의 **Railway 서버 + R2** 방식을 권장합니다.
