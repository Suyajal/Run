# Suyajal Run

삼성 헬스와 Apple Fitness의 러닝 캡처를 분석해 운동 기록을 등록하고, 친구나 그룹과 공유하는 반응형 웹 앱입니다. 기존 PostgreSQL의 `public` 스키마를 사용합니다.

## 로컬 실행

이 작업 폴더에는 PostgreSQL 접속값을 담은 로컬 `.env`와 앱 의존성이 준비되어 있습니다. Windows 실행 스크립트는 Codex에 포함된 Node.js를 먼저 찾고, 해당 런타임이 없으면 PowerShell에서 사용할 수 있는 Node.js를 사용합니다.

```powershell
.\start.cmd
```

다른 환경에서 처음 설치할 때는 Node.js 24와 pnpm으로 `pnpm install --frozen-lockfile`을 실행하고, `.env.example`을 복사해 `.env`에 접속값과 비밀 키를 지정합니다.

- [사용자 앱](http://127.0.0.1:3000)
- [관리자 페이지](http://127.0.0.1:3000/admin)
- [PostgreSQL 연결 상태](http://127.0.0.1:3000/api/health)

로그인 전 대시보드의 숫자와 기록은 둘러보기용 샘플입니다. 로컬 환경에서 `DEV_SKIP_SIGNUP_SMS=1`이면 이름, 아이디, 비밀번호만 입력해 테스트 계정을 만들 수 있습니다. 테스트 계정에 실제 휴대폰 번호를 연결하려면 로그인 후 전화번호 변경에서 문자 인증을 완료합니다. 비밀번호 초기화와 아이디 찾기는 가입 전화번호가 연결된 계정에 제공됩니다.

## 계정과 문자 인증

`SMS_WEBHOOK_URL`에 HTTPS 문자 발송 어댑터를 설정합니다. 서버는 `{to, message}`를 JSON으로 POST합니다. `SMS_WEBHOOK_TOKEN`을 지정하면 Bearer 인증 헤더를 보냅니다. 로컬 개발 환경에서는 `DEV_SMS=1`로 인증번호를 서버 콘솔에서 확인할 수 있습니다. 운영 환경에서는 이 값을 비워 둡니다.

관리자 화면은 현재 `public.admin_access`가 `ACTIVE`인 계정으로 로그인하면 열립니다. 운영 관리자가 지정한 계정의 권한을 해당 테이블에서 관리합니다. 앱은 관리자 권한을 자동으로 부여하지 않습니다.

전화번호 암호화와 정확 검색에는 안정적으로 보관한 `APP_SECRET`을 사용합니다. 기존 회원을 연결하려면 해당 데이터가 만들어진 키와 암호화·검색 규칙이 일치해야 합니다. 비밀번호 해시는 Argon2id를 검증합니다.

## 기록과 순위

- 캡처 원본과 분석용 이미지는 메모리에서 처리합니다. OCR 결과의 운동 수치와 이미지 해시를 저장하며, 사용자가 검토하고 확정한 기록만 순위에 반영합니다.
- 첫 OCR 실행에는 Tesseract 언어 데이터 다운로드가 필요합니다. `OCR_LANG=eng+kor`로 영어와 한국어를 사용합니다. 실제 캡처 레이아웃에 따라 인식률이 달라질 수 있습니다.
- 주간 집계는 한국 시간 월요일부터, 월간 집계는 달력 월 기준입니다. 동률은 공동 순위로 집계합니다. 친구 공유의 최초 확정 알림은 앱 내 알림함으로 전달됩니다.
- 기기 푸시 발송과 iOS·Android 네이티브 패키징은 현재 구현 범위에 포함되지 않습니다. OCR은 로컬 프로세스에서 동작하며, 서버가 분석 중 종료되면 사용자가 캡처를 다시 선택합니다.

## 연결 설정

### Vercel에서 Cloud SQL 연결

Cloud SQL 인스턴스에 공인 IP가 있어야 합니다. Google Cloud 프로젝트에서 Cloud SQL Admin API를 활성화하고, 배포용 서비스 계정에 Cloud SQL Client (`roles/cloudsql.client`) 역할을 부여합니다.

Vercel Production 환경 변수에 다음 값을 등록한 뒤 재배포합니다.

- `CLOUD_SQL_INSTANCE_CONNECTION_NAME`에는 Cloud SQL 인스턴스 개요의 연결 이름(`프로젝트:리전:인스턴스`)을 입력합니다.
- `CLOUD_SQL_CREDENTIALS_JSON`에는 서비스 계정 키 JSON 전체를 Secret으로 등록합니다. 로컬에서 Application Default Credentials를 사용한다면 생략할 수 있습니다.
- `PGDATABASE`, `PGUSER`, `PGPASSWORD`는 기존 PostgreSQL 값을 유지합니다. `APP_SECRET`도 기존 값을 유지합니다.

Connector는 인증과 TLS 연결을 처리하며 승인된 네트워크에 Vercel IP를 등록할 필요가 없습니다. Vercel의 기존 `PGHOST`, `PGPORT`, `PG_TLS_PIN_PEM`, `PG_TLS_PIN_FILE`, `PGSSLMODE` 설정은 Connector 전환 후 제거할 수 있습니다. 재배포 후 `/api/health`에서 연결을 확인합니다.

### 로컬 직접 연결

현재 로컬 환경은 제공된 DB에서 관찰한 서버 인증서를 `PG_TLS_PIN_FILE`로 고정합니다. DB 인증서를 갱신하면 운영자가 확인한 새 인증서 또는 CA 파일로 연결 설정을 갱신합니다. CA로 연결할 때는 `PGSSLMODE=verify-full`과 `PGSSLROOTCERT`를 사용합니다.

HTTPS 역방향 프록시 뒤에서 실행하는 경우 `COOKIE_SECURE=1`과 서비스의 정확한 `APP_ORIGIN`을 설정합니다.

