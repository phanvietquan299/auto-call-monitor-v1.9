AUTO CALL MONITOR

Chrome extension để theo dõi VT/CDR, xử lý locked và điều khiển FS.
App điện thoại dùng chung giao diện qua Supabase; máy chạy extension vẫn cần hoạt động.

CẤU TRÚC
  manifest.json       Điểm vào Chrome extension — tải cả thư mục dự án này.
  src/core/           Quy tắc VT/CDR, AUTO BLOCK, thay FS và xuất Excel.
  src/background/     Service worker, hàng đợi, lịch sử và đồng bộ từ xa.
  src/content/        Script chạy trong OpenSIPS, FreeSWITCH, Grafana.
  src/ui/             Dashboard, popup và giao diện thay FS trên máy tính.
  src/mobile/         Adapter điện thoại, service worker và tài nguyên PWA.
  config/             Mẫu cấu hình và cấu hình local (không đưa bí mật lên Git).
  scripts/            Kiểm tra cấu trúc, build và publish/deploy.
  supabase/           Schema SQL và Edge Function Telegram/remote control.
  mobile-app/         Đầu ra build để publish; không chỉnh trực tiếp.
  tests/              Kiểm thử local; vẫn được loại khỏi Git theo yêu cầu.
  docs/               Kiến trúc, hướng dẫn và lịch sử phiên bản.
  deploy/             Công cụ kiểm tra mạng và tài liệu chuẩn bị server.

CHẠY EXTENSION
  Chrome → Extensions → Developer mode → Load unpacked → chọn thư mục gốc này.
  Sau khi đổi cấu trúc: bấm Reload extension rồi tải lại các tab OpenSIPS,
  FreeSWITCH/Grafana và mở lại dashboard bằng biểu tượng extension.

CẤU HÌNH
  Sao chép config/supabase-config.example.js thành config/supabase-config.js.
  Cấu hình đang dùng trên máy đã được chuyển sang thư mục config.
  Không đặt PAT, service_role hoặc secret API key vào mã public.

LỆNH THƯỜNG DÙNG — chạy từ thư mục gốc
  npm ci
  python3 scripts/check-layout.py
  python3 scripts/build-mobile.py
  npm test
  npm run check:browser
  python3 scripts/publish-mobile.py

  Test trình duyệt cần cài Chromium một lần: npx playwright install chromium.
  Publish cập nhật nhánh gh-pages. Deploy Vercel dùng scripts/deploy-vercel.py.
  Các lệnh publish/deploy có tác động bên ngoài; chỉ chạy khi muốn phát hành.

Chi tiết: docs/ARCHITECTURE.txt
Lịch sử phiên bản: docs/CHANGELOG.txt
Chuẩn bị triển khai: DEPLOY.txt và deploy/SERVER.txt
