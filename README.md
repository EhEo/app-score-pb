# COURTSIDE · 피클볼 점수판

휴대폰에서 기록하고 태블릿에서 함께 보는 한국어 웹 점수판입니다. 로그인 없이 단독 사용도 가능합니다.

공개 테스트: **https://courtside-pickleball.ithaca74.workers.dev**

소스: https://github.com/EhEo/app-score-pb

## Cloudflare Workers

정적 화면은 Workers Assets로, 경기 상태와 태블릿 실시간 연결은 SQLite 기반 Durable Objects와 WebSocket으로 제공합니다. 별도 Node 서버나 영구 디스크는 필요하지 않습니다.

```sh
npm ci
npm run dev:worker
```

로컬 Workers 주소는 기본 `http://localhost:8787`입니다.

```sh
npx wrangler login
npm run build
npm run deploy
```

설정 파일은 `wrangler.jsonc`이며, 최초 배포에서 `ScoreRoom` Durable Object 마이그레이션이 실행됩니다. 사용하지 않은 연결방은 마지막 상태 변경 후 7일 뒤 만료됩니다. 기기에 저장한 완료 경기 기록은 별도로 유지됩니다.

### GitHub 자동 배포 연결

Cloudflare 대시보드에서 `Workers & Pages → courtside-pickleball → Settings → Builds → Connect`로 이동합니다.

- 저장소: `EhEo/app-score-pb`
- 프로덕션 브랜치: `main`
- 루트 디렉터리: `/`
- 빌드 명령: `npm run build`
- 배포 명령: `npx wrangler deploy`
- 미리보기 브랜치 배포: 사용 안 함 (프로덕션 경기 상태 격리 전까지)

Cloudflare GitHub App에 이 저장소 접근을 허용해야 합니다. 로컬 Wrangler OAuth 로그인과 대시보드 GitHub 연결은 별도 인증입니다. GitHub Actions의 `Checks`는 코드·브라우저 테스트와 Workers 빌드를 검증하며, 배포 자체는 Cloudflare Builds 연결 시 담당합니다.

## 실행

Node.js 22 이상에서:

```sh
npm install
npm start
```

PC에서 `http://localhost:3000`을 엽니다. `PORT` 환경변수로 포트를 변경할 수 있습니다.

## 실제 휴대폰·태블릿에서 사용

두 기기에서 **동일한 공개 HTTPS 주소**를 여세요. 공개 Workers 배포는 위 테스트 주소를 이용하면 됩니다. 아래 Node 실행은 로컬 개발용 대체 경로입니다. Node 경로에서는 `.data` 디렉터리에 연결방을 보관하므로 단일 서버 인스턴스와 영구 디스크가 필요합니다. `DATA_DIR`로 위치를 변경할 수 있습니다.

1. 휴대폰에서 주소를 열고 ‘새 경기 시작’을 선택합니다.
2. 공식/자유 점수, 단식/복식, 목표 점수, 경기 구성을 설정합니다.
3. 복식 공식 모드에서는 각 팀의 처음 오른쪽 선수와 최초 서브 팀을 확인합니다.
4. ‘태블릿 연결’을 누릅니다. 태블릿으로 QR을 스캔하거나, 같은 주소의 ‘표시용 태블릿 연결’에서 8자리 코드를 입력합니다.
5. 휴대폰에서 랠리 승리 팀을 누릅니다. 태블릿에서는 음성을 한 번 켜면 이후 점수를 안내합니다.

`localhost`는 각 기기 자신을 가리키므로 PC의 localhost QR로 다른 기기를 연결할 수 없습니다. 같은 Wi-Fi에서 PC IP로 기본 동작을 시험할 수 있지만, HTTPS가 아닌 주소에서는 오프라인 캐시·홈 화면 기능 등이 제한됩니다. 실사용은 HTTPS가 필요합니다.

## 기능

- 공식 모드: 전통적 사이드아웃 점수제, 단식·복식, 11/15/21점, 2점 차 승리. 첫 복식 서브 0–0–2, 이후 서버 전환과 선수 위치 추적.
- 자유 모드: 서브권 없이 매 랠리 득점, 1~999점 목표, 2점 차 승리 선택.
- 단판 / 3판 2선승. 게임 사이에 최초 오른쪽 선수 재선택.
- 되돌리기, 점수·서브 팀·서버·현재 선수 위치 수정, 좌우 화면 전환.
- 진행 경기와 모든 되돌리기 상태를 조작 브라우저에 저장. 완료 경기 결과도 같은 브라우저에 보관.
- 휴대폰 조작 권한은 비밀 토큰으로 보호하고, 태블릿에는 조회용 코드만 전달. 표시용 기기는 동시에 1대 연결.
- 휴대폰 오프라인 입력 후 최신 상태 동기화. 태블릿은 마지막 점수와 연결 끊김 표시.
- 태블릿 한국어 음성, 전체 화면, 지원 브라우저에서 화면 켜짐 유지.
- 서비스 워커로 첫 접속 이후 앱 화면을 오프라인 캐시.

공식 모드는 [USA Pickleball의 전통적 사이드아웃 규칙 요약](https://usapickleball.org/rules/summary/)을 기준으로 구현했습니다. 경기 도중 코트 이동은 심판이 ‘좌우 바꾸기’로 화면에 반영합니다. 판정·폴트 종류·타임아웃은 자동 판정하지 않습니다.

## 저장과 연결 주의사항

- 휴대폰이 기록의 기준입니다. Workers 배포는 PC가 꺼져 있어도 사용할 수 있습니다. 로컬 Node 경로는 PC 서버가 실행 중이어야 합니다.
- 음성은 브라우저가 제공하는 한국어 음성을 사용합니다. 설치 음성·자동 재생 정책에 따라 지원이 달라집니다. 연동 중에는 태블릿에서만 활성화합니다.
- 기기의 브라우저 데이터를 지우면 경기 기록과 조작 권한이 삭제됩니다. 다른 기기에서 내 기록 복구는 지원하지 않습니다.
- QR/경기 코드를 아는 사람은 점수를 조회할 수 있습니다. 공개 공유하지 마세요. Workers 연결방은 마지막 변경 후 7일 뒤 만료되며, 로컬 Node 연결방은 수동 관리합니다.
- 홈 화면 추가: iPhone/iPad Safari의 공유 → 홈 화면에 추가, Android Chrome 메뉴 → 홈 화면에 추가. 설치 메뉴는 브라우저에 따라 다릅니다.

## 검증

```sh
npm run check
npm test
```

브라우저 통합 테스트는 설치된 Google Chrome을 사용합니다. 없으면 Chrome을 설치하거나 Playwright의 실행 채널을 환경에 맞게 변경하세요. 테스트는 별도의 임시 데이터 폴더와 서버를 사용합니다. 화면 캡처는 `artifacts/`에 저장됩니다.

Workers 로컬 서버 또는 배포된 주소의 API, 단일 표시 기기 제한, QR, 모바일 터치, 실시간 반영, 오프라인 재연결, 360/390/430px 화면·태블릿·가로 모드 검증:

```sh
node scripts/verify-deployment.mjs http://localhost:8787
node scripts/verify-deployment.mjs https://courtside-pickleball.ithaca74.workers.dev
```

검증 스크립트는 대상에 테스트 연결방을 생성합니다. Workers에서 7일 후 자동 정리됩니다. API 토큰·OAuth 자격 증명·실제 경기 데이터·화면 캡처는 저장소에 포함하지 않습니다.
