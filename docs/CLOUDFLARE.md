# Cloudflare 공용 저장소 연결 (Railway 호스팅 + Cloudflare Worker + R2)

현재 구성:
- **프론트엔드**: Railway (`https://...up.railway.app`)
- **저장**: 기본은 브라우저 localStorage

아래처럼 **Cloudflare Worker + R2** 를 붙이면, 사이트에 접속하는 모든 사람이
**하나의 공용 저장소**에서 같은 현장·분석 데이터를 보고 저장하게 됩니다.

```
[Railway 앱] --(fetch /api/projects)--> [Cloudflare Worker] --> [R2 버킷]
```

## 개인정보

- 명부(사용자 정보)는 업로드 시점에 개인정보가 제거된 뒤 저장됩니다
  (이름·건물·동·호·전화·스마트카드·이메일 제거, 차량번호·차종만 유지).
- 따라서 R2에는 **이름·연락처가 저장되지 않습니다.**

---

## A. 대시보드(브라우저)만으로 설정 — 터미널 불필요

### 1. R2 버킷 만들기
1. Cloudflare 대시보드 → **R2 Object Storage** → (처음이면 R2 사용 활성화)
2. **Create bucket** → 이름 `unitconnect-cmo-store` → 생성

### 2. Worker 만들기
1. **Workers & Pages → Create → Create Worker** → 이름 `unitconnect-cmo-store` → Deploy
2. **Edit code** → 기존 내용 지우고 `worker/worker-dashboard.js` 내용을 붙여넣기 → **Deploy**

### 3. Worker에 R2 버킷 연결 (가장 중요)
1. Worker → **Settings → Bindings → Add → R2 bucket**
2. **Variable name** 에 정확히 `BUCKET` 입력
3. Bucket 은 1번에서 만든 `unitconnect-cmo-store` 선택 → 저장/Deploy

### 4. Worker 주소 복사
예: `https://unitconnect-cmo-store.<계정>.workers.dev`

### 5. Railway 앱 연결
Railway → 서비스 → **Variables**:

| 변수 | 값 |
|------|-----|
| `VITE_REMOTE_STORE` | `1` |
| `VITE_API_BASE` | `https://unitconnect-cmo-store.<계정>.workers.dev` |

저장 → Railway 자동 재빌드(1~2분).

### 6. 확인
다른 브라우저/폰에서 접속 → 한쪽에서 현장 저장 → 다른 쪽 새로고침 시 동일하게
보이면 성공.

---

## B. 터미널(wrangler)로 설정 — 익숙한 경우

```bash
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create unitconnect-cmo-store   # wrangler.toml의 bucket_name과 동일
npx wrangler deploy
```
이후 Railway Variables 설정은 A-5 와 동일.

---

## (선택) 아무나 못 쓰게 막기 — 공유 키

- Worker: Settings → Variables 에 `AUTH_KEY = 정한값` 추가(또는 wrangler.toml `[vars]`)
- Railway: `VITE_APP_KEY = 정한값`(동일) 추가 후 재빌드

> 프론트엔드에 넣는 키라 브라우저에서 볼 수는 있어 완전한 보안은 아니지만,
> 무작위 접근·봇은 막아줍니다.

## 동작 방식 (참고)

- Worker API: `GET /api/projects`(목록), `PUT /api/projects`(전체 저장)
- 저장 단위: 프로젝트 배열 전체를 R2 객체 하나(`projects.json`)에 저장
- 앱의 저장소 전환 지점: `src/lib/store.ts` (환경변수로 local ↔ remote)
- 파일이 아주 많아지면 "현장별 개별 저장 + 원본 파일 R2 개별 보관" 구조로
  확장하는 것을 권장.
