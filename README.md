# 사뿐

HTML·CSS·JavaScript로 만든 여행 플래너입니다. React나 별도 의존성 설치 없이 실행합니다.

## GitHub Pages 배포

1. 이 프로젝트를 GitHub 저장소에 올립니다. `*.private.*` 파일과 `imports/`의 개인 자료는 업로드하지 않습니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
3. `main` 브랜치에 올리면 배포됩니다. **Actions → Deploy Sappun to GitHub Pages**에서도 수동 실행할 수 있습니다.
4. 완료된 실행의 **github-pages** 링크로 접속합니다.

비공개 저장소의 Pages는 GitHub Pro/Team 등 지원 플랜이 필요합니다. 저장소 비공개 여부와 배포된 웹사이트의 접근 범위는 별개입니다.

## 로그인 · 비공개 저장 · 비밀번호 공유

사이트 화면은 GitHub Pages, 로그인과 데이터 저장은 Cloudflare Workers + D1으로 나눕니다. 파일을 직접 열거나 localhost/127.0.0.1에서 열면 **로그인 버튼만 눌러 화면 미리보기**에 들어갑니다. 서버 연결 후에도 로컬 미리보기는 유지합니다. 입력값은 검사·전송하지 않으며 서버 저장이나 가짜 로그인 세션을 만들지 않습니다. 배포 주소와 공유 링크에는 이 미리보기를 적용하지 않습니다. 서버의 모든 개인 데이터 요청에서 로그인 권한을 검사합니다. 공개 회원가입은 없으며 운영자 계정 1개를 설정하는 테스트 버전입니다.

- 내 계정: 로그인 후 나의 모든 여행을 비공개 서버 저장소에 자동 저장합니다. 로그인 세션은 현재 탭에서 최대 12시간 유지합니다. 기기와 서버 내용이 다르면 먼저 사용할 쪽을 고릅니다. 서버 쪽을 선택할 때 기존 기기 내용은 브라우저의 `sappun-device-before-cloud` 항목에 보존합니다. 로그아웃해도 기기에 남은 내용은 지우지 않습니다.
- 충돌 방지: 다른 기기에서 먼저 수정했으면 덮어쓰기를 멈춥니다. **내 계정 → 서버 일정 다시 불러오기**로 확인합니다. 통신 실패 때는 기기에 저장하고 상태를 표시합니다. 탭을 닫기 전 서버 저장을 확인하세요.
- 친구: 선택한 여행에서 **공유**를 누르고 비밀번호(8자 이상)와 만료일(최대 90일)을 지정합니다. 친구는 공유 링크에서 비밀번호만 입력합니다. 계정 로그인이나 편집 권한은 없습니다.
- 공유 범위: 선택한 탭·메모·비용·여행자 정보를 읽기 전용으로 보여줍니다. 원본 일정은 서버에 저장되면 공유 화면에 약 30초 안에 반영됩니다. 공유 설정은 기존 링크의 ‘선택 설정 반영’으로 바꿉니다.
- 자료실: 새로 선택해 올린 첨부파일은 로그인한 계정의 비공개 저장소에 자동 저장합니다. 자료실을 공유하면 비밀번호로 확인된 친구가 링크 미리보기와 파일 열기·다운로드를 사용할 수 있습니다. 파일당 5MB, 전체 200MB로 제한합니다. 기존 브라우저 파일은 해당 여행의 자료실을 공유할 때 함께 업로드합니다. 업로드 실패는 화면에 표시합니다.
- 취소와 만료: 서버는 조회할 때마다 확인하며, 열려 있는 친구 화면도 30초마다 확인해 닫습니다. 확인할 수 없는 경우에도 공유 화면을 닫습니다. 이미 본 내용을 캡처하거나 복사한 것까지 회수할 수는 없습니다.
- 지도: 좌표가 저장된 일정의 핀 번호·위치를 재현합니다. 저장되지 않은 장소는 검색을 자동 실행하지 않습니다. 친구 지도에 사용할 배포용 브라우저 키 설정이 필요합니다.

### Cloudflare 첫 연결

이 작업에는 Cloudflare 계정이 필요합니다. 비밀번호와 API 토큰을 소스나 채팅에 넣지 마세요.

1. Cloudflare에 로그인합니다: `npx wrangler@4 login`
2. D1을 만듭니다: `npx wrangler@4 d1 create sappun --config server/wrangler.jsonc`
3. 결과의 데이터베이스 ID를 `server/wrangler.jsonc`의 `database_id`에 넣습니다. `APP_ORIGIN`은 GitHub Pages의 **출처만** 넣습니다. 예: `https://사용자명.github.io` (저장소 경로 제외). 로컬 테스트는 `http://localhost:포트`를 사용하며 파일을 직접 여는 방식은 서버 접속에 사용할 수 없습니다.
4. 초기 Worker를 Cloudflare 대시보드에서 `sappun-api` 이름으로 만듭니다. 운영자 아이디는 `npx wrangler@4 secret put OWNER_USERNAME --config server/wrangler.jsonc`로 입력합니다.
5. 로그인 비밀번호는 `node server/make-owner-password.mjs`로 직접 입력합니다. 입력은 화면에 표시하지 않으며 해시만 Cloudflare Secret에 전달합니다. 공개 저장소에 비밀번호나 해시를 저장하지 않습니다. 아이디·비밀번호 변경 후 기존 세션도 끊으려면 D1의 `sessions`를 비웁니다.
6. 테이블을 만듭니다: `npx wrangler@4 d1 execute sappun --remote --file server/schema.sql --config server/wrangler.jsonc`
7. 서버를 배포합니다: `npx wrangler@4 deploy --config server/wrangler.jsonc`
8. 발급된 `https://sappun-api.…workers.dev` 주소를 `js/cloud-config.js`의 `apiBase`에 넣습니다. 여기에는 공개 서버 주소만 넣습니다.
9. Google Maps JavaScript API를 사용할 브라우저 키를 `npx wrangler@4 secret put MAPS_BROWSER_KEY --config server/wrangler.jsonc`로 설정합니다. 브라우저용 지도 키는 친구의 브라우저에도 전달되므로 Google Cloud에서 배포 사이트와 Maps JavaScript API로 제한해야 합니다. 서버용 비밀 키를 넣지 마세요. 이 키를 설정하지 않으면 공유 일정은 보이지만 핀 지도는 표시되지 않습니다. Google 지도 이용료는 별도입니다.

Worker 자동 배포를 사용하려면 GitHub 저장소의 **Secrets and variables → Actions**에서 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`를 Secret으로 등록합니다. 토큰에는 해당 계정의 Workers Scripts 편집 및 D1 편집 권한만 부여합니다. 위 설정을 완료한 다음 저장소 Variable `CLOUDFLARE_READY`를 `true`로 설정합니다. 이후 `server/` 변경을 main/master에 올리면 Worker도 배포됩니다. **Deploy Sappun private API**에서 수동 실행할 수도 있습니다. 로그인 비밀번호·해시는 GitHub Secret에도 필요 없습니다.

무료 사용량을 넘지 않는 테스트 운영을 전제로 하며, 유료 플랜으로 자동 변경하도록 구성하지 않습니다. 저장 용량을 줄이기 위해 만료·취소한 공유와 오래된 인증 기록을 매일 정리합니다.

서버 권한 테스트: `node tests/cloud-api.test.mjs` (Node 24 이상). 로그인, 무단 열람 차단, 충돌, 공유 비밀번호, 읽기 전용, 만료, 취소, 시도 제한, 비공개 항목 제외를 실제 SQLite로 검사합니다.

## 기존 일정 가져오기

서버 연결 후 로그인하면 일정은 계정에 자동 저장합니다. 첨부파일의 실제 내용은 브라우저에만 보관하며 다른 기기에 자동 동기화하지 않습니다. 기존 **백업**과 **불러오기**도 사용할 수 있습니다.

새로 접속하면 여행이 없는 상태에서 시작합니다. 개인 일정·원본 노션 내보내기·자동 예시는 소스와 배포물에 포함하지 않습니다.

지도 API 키는 파일이나 영구 여행 저장소에 넣지 않습니다. 앱의 **지도 연결**에서 입력한 키는 현재 탭 세션에서만 보관하고 백업과 서버 저장에서도 제외합니다. 배포용 지도 키를 설정하면 로그인·공유 확인 후 서버에서 전달합니다. 브라우저용 지도 키는 실행 중 네트워크 요청에서 확인할 수 있으므로 Google Cloud에서 배포 도메인과 사용할 API를 제한합니다. 서버 비밀 키는 이 앱에 입력하지 않습니다.

## 배포 파일 확인

```sh
node scripts/build-pages.mjs
```

`dist/`에 실제 웹페이지에서 참조하는 파일만 준비합니다. 개인 노션 원본·테스트·개발 설정은 배포에 포함하지 않습니다.

```sh
node tests/public-release.test.cjs
```

빈 상태의 앱 시작, 개인 원본 제거, API 키의 세션 보관과 영구 저장·내보내기 제외를 검사합니다.

```sh
node scripts/audit-public.mjs
```

작업 파일·Git에 준비된 파일 내용·배포 결과물에서 개인 자료 경로와 주요 키·토큰·인증서 패턴을 검사합니다. 결과는 값 없이 `output/privacy-audit.json`에 기록하며, 의심 항목이 있으면 자동 배포를 중단합니다.
