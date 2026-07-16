# 데이터 분석 (CSV/Excel 요약 통계)

CSV·Excel 파일을 업로드하면 **브라우저에서 바로** 요약 통계를 계산해주는 정적 웹 앱입니다.
데이터는 서버로 전송되지 않고 전부 사용자의 브라우저 안에서만 처리됩니다.

## 주요 기능

- **파일 업로드**: 드래그 앤 드롭 또는 클릭으로 CSV·Excel(`.xlsx`, `.xls`) 업로드
- **데이터 개요**: 행/열 개수, 결측 셀 비율
- **요약 통계**
  - 숫자형 컬럼: 개수, 결측, 평균, 표준편차, 최소, 25%, 중앙값, 75%, 최대
  - 범주형 컬럼: 개수, 결측, 고유값 수, 최빈값과 빈도
- **데이터 미리보기**: 상위 20행 테이블
- 라이트/다크 테마 자동 대응

## 기술 스택

- [React](https://react.dev/) + [Vite](https://vitejs.dev/) + TypeScript
- [PapaParse](https://www.papaparse.com/) — CSV 파싱
- [SheetJS(xlsx)](https://sheetjs.com/) — Excel 파싱

서버 없이 동작하는 정적 사이트라 GitHub Pages 등 정적 호스팅에 바로 배포할 수 있습니다.

## 개발

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 타입체크 + 프로덕션 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기
```

## 컬럼 타입 추론 규칙

각 컬럼에서 결측을 제외한 값 중 **80% 이상**이 숫자로 변환되면 숫자형(numeric),
그렇지 않으면 범주형(categorical)으로 분류합니다. 천 단위 콤마(예: `1,234.5`)는
숫자로 인식합니다.

## 프로젝트 구조

```
src/
  lib/
    parse.ts    # CSV/Excel → Dataset 파싱
    stats.ts    # 타입 추론 및 요약 통계 계산
  components/
    Dropzone.tsx       # 파일 업로드 영역
    DataPreview.tsx    # 데이터 미리보기 테이블
    SummaryStats.tsx   # 요약 통계 테이블
  App.tsx       # 전체 레이아웃 및 상태 관리
  types.ts      # 공용 타입 정의
```
