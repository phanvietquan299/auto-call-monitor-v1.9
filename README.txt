1.17.18: Luồng VT + CDR tiếp tục xét BLOCK dự phòng sau mỗi lần đổi, tối thiểu 5s/lượt, không giới hạn một lần dự phòng. Chỉ đổi số ACTIVE mới khi VT không tăng và CDR mới tiếp tục 5/5 lỗi; giữ lịch, chế độ tay/tự động và kiểm tra chống trùng số.

1.17.17: Collection/Sale kết thúc nghỉ qua đêm lúc 08:00 giờ Việt Nam thay vì 09:00. Nâng cấu hình đã lưu sang giờ mới; giữ lịch nghỉ trưa, giờ kết thúc ngày và MONITORING tắt tay.

1.17.16: Mục Cảnh báo cần xử lý trên app/tool: lỗi đổi số/kết quả chưa xác minh, thay FS thất bại, đã đổi >=2 số nhưng VT không tăng và CDR mới vẫn lỗi sau 5s. Có Đã xem, không hiện các lần đổi thành công trong mục cảnh báo.

1.17.15: Bỏ dòng nhắc kiểm tra lại số dưới ô trạng thái; giữ nguyên xác minh FreeSWITCH trước khi đổi.

1.17.14: Không khóa ô trạng thái vì cờ disabled cũ trên FreeSWITCH. Khi đổi tay, đọc lại và tự refresh tab nếu control chưa sẵn sàng trước khi ghi; không tự retry thao tác đã gửi. Có nút Đọc lại số khi chưa có số ACTIVE.

1.17.13: Ô đổi trạng thái luôn hiện dưới FS ở mọi state, kể cả RECOVERING. Không ẩn khi chờ số ACTIVE; chưa có số hiển thị ô chờ cập nhật. Số đã biết vẫn cho yêu cầu đổi khi cache cũ, backend đọc lại số/trạng thái trước thao tác.

1.17.12: App đăng nhập bằng mật khẩu, phiên lưu 30 ngày. Đặt/đổi mật khẩu từ tool hoặc app đang đăng nhập; bcrypt phía server, giới hạn thử sai, đổi mật khẩu thu hồi các phiên khác. Liên kết một lần vẫn dùng để khởi tạo/khôi phục.

1.17.11: Màu xanh của FS và số ACTIVE chỉ hiện khi Group ID OpenSIPS xác nhận FS đang chạy. FS tắt/chưa xác minh/dữ liệu cũ dùng màu trung tính, vẫn giữ nguyên trạng thái số FreeSWITCH và thao tác đổi tay.

1.17.10: App hiển thị phiên bản và nút Cập nhật app, asset JS theo phiên bản, service worker kiểm tra mạng và dọn cache cũ để nhận giao diện mới. Không cập nhật giữa thao tác đang chờ kết quả.

1.17.9: Giữ số BACKUP được chọn dưới FS, BLOCKED chuyển sang số ACTIVE mới. Cache từng FS độc lập bộ lọc inventory, không chọn ngẫu nhiên từ danh sách BACKUP/BLOCKED; dữ liệu chưa xác minh mới chỉ xem, không cho ghi.

1.17.8: Hiện số ACTIVE và ô ACTIVE/BACKUP/BLOCKED dưới từng FS; đổi tay qua hàng đợi chung, đọc lại đúng số/trạng thái trước thao tác, đồng bộ quan sát thay tay với AUTO BLOCK. Hỗ trợ app điện thoại.

1.17.7: App báo ngay khi gửi/đang xử lý/hoàn tất lệnh. Bỏ đọc trạng thái mạng thừa trước và sau lệnh, kiểm tra kết quả mỗi 500ms, chặn gửi trùng khi đang chờ.

1.17.6: Ô đặt trước Tắt chỉ hiện FS đang chạy, Bật chỉ hiện FS đang tắt theo Group ID mỗi nhóm. Cập nhật theo trạng thái mới, giữ lựa chọn còn hợp lệ; loại dữ liệu cũ/không xác minh.

1.17.5: Xét chuyển FS dùng cùng BACKUP tổng quan mới <=45s như số hiển thị, không đếm nhầm 0 khi lọc ACTIVE. Tổng quan cũ không cho tự chuyển dựa trên 0 giả; vẫn yêu cầu đúng một ACTIVE và Group ID/VT/CDR/lịch nghỉ.

1.17.4: Đồng bộ bỏ cdr.traffic.observed nội bộ (~400KB/gói cũ), chỉ 3 dòng CDR và trạng thái cần hiển thị. Publish 2s, timeout30s, không chồng request. Claim command chỉ device ID, không gửi trùng snapshot. Hoàn tất RPC trực tiếp không phụ thuộc Telegram.

1.17.3: Kết quả lệnh lưu trực tiếp RPC Supabase, thông báo Telegram riêng best-effort; Telegram lỗi không chặn command kế tiếp/app kết quả. Kiểm thử mobile enqueue/claim/result và transport thực tế, không thao tác FS thật trong kiểm thử.

1.17.2: Request remote/mobile kèm public apikey ở header và URL fallback, kiểm tra key và lưu remoteSync lỗi/lastPublishedAt để dashboard hiển thị lỗi thật; không đưa PAT/history token vào URL.

1.17.1: Tách publish snapshot khỏi command, vẫn gửi khi đang đổi FS/chờ kết quả Telegram. App đọc state trong nền một request/lượt, render dùng cache tức thì tránh renderSequence bỏ mọi frame khi mạng >1s. Tự đọc lại sau lỗi/online/quay lại app. Telegram chỉ cấp đăng nhập, không là đường truyền dữ liệu.

1.17.0: PWA iPhone/macOS dùng cùng dashboard HTML/JS, transport remote qua Supabase, snapshot máy 1s. Telegram /app cấp link một lần 5 phút; phiên mobile 12h; chỉ public anon key trong frontend. Mobile command queue cùng handler desktop, không chạy lại khi kết quả chưa rõ. GitHub Pages gh-pages chỉ mobile assets, không secrets. Máy cần reload extension để cung cấp dashboard snapshot.

1.16.1: Telegram /menu mở dashboard nhóm Col/Sale, nút Monitor/Block/Thay FS + mode, ngưỡng và wizard đặt FS. Callback sửa tin hiện tại, không trôi chat; log thông báo Việt hóa, không lặp menu dài dưới mỗi cảnh báo.

1.16.0: Telegram bot CallCenter16725bot qua Supabase Edge Function + hàng đợi lệnh riêng. Chỉ chat/user cấu hình, webhook secret, mọi thay đổi cần xác nhận 90s, command claim một lần không retry thao tác khi kết quả mơ hồ. Máy online poll 5s/alarm 30s. Menu/status/CDR/cảnh báo/log/thống kê, Monitor/BLOCK/Thay FS hai mode, ngưỡng, bật/tắt, đặt riêng/cặp, Reload, xác nhận/hủy/recheck/ack/report/release/xóa log. Bot token chỉ secrets backend. Người dùng phải Start bot để nhận tin.

1.15.1: Lịch sử chính lưu PostgreSQL Supabase project callcenter qua RPC có mã truy cập giới hạn lịch sử. PAT/service_role không vào extension. IndexedDB là outbox/offline và tự di chuyển log cũ; retry 15s/alarm 30s, không chặn thao tác realtime bởi mạng. Xóa phải kết nối Supabase, không xóa local khi server lỗi. supabase-config.js local bị ignore; cần giữ file khi tải extension. Chưa triển khai giao diện/điều khiển điện thoại.

1.15.0: Lịch sử thành công lưu IndexedDB auto-call-history, không tự xóa. Di chuyển log còn trong storage sang DB; state realtime giữ tối đa 200 sự kiện. Lọc ngày/xóa thời gian đọc DB, bảng phân trang giữ nguyên. DB local, chưa đồng bộ server; gỡ extension có thể mất dữ liệu.

1.14.24: Đặt riêng chỉ tắt/chỉ bật FS ở lần locked tiếp theo bằng chọn — ở ô bỏ qua; chỉ bật kích hoạt khi một FS cùng nhóm locked. Hai mode, một lần, Save + Reload và log chung giữ nguyên.

1.14.23: Ngưỡng BACKUP cấu hình và lưu qua ô nhập số; áp dụng hai mode, mặc định 10. Trạng thái chuyển FS nằm dưới thống kê/lịch sử.

1.14.22: Cặp đặt FS dùng grid thẳng cột, responsive màn nhỏ, nút Lưu xanh và Hủy viền nhẹ; trạng thái nhỏ gọn dưới từng nhóm. Không đổi logic.

1.14.21: FS vừa bật có mẫu VT mới không tăng và CDR mới 5/5 thì BLOCK ngay, không chờ cứng 5s. Dự phòng số chờ 5s, tiếp tục đánh giá; lượt Thay FS đã xác minh không cộng thêm 30s. Giữ giãn thao tác 3s, hai mode và một lần dự phòng.

1.14.20: Luồng hybrid kết thúc Thay FS sau Save + Reload xác minh, bỏ khóa chờ HEALTHY và watcher BLOCK riêng. AUTO BLOCK tiếp quản FS vừa bật với quy tắc VT/CDR, hai mode. Lượt lỗi theo dõi cũ chỉ được gỡ khi dữ liệu mới xác minh nguồn 0/đích đúng Group ID; không gỡ lỗi ghi chưa rõ.

1.14.19: Rút gọn phần đặt FS; bỏ link lịch sử/kiểm tra chi tiết. Cảnh báo CDR đặc biệt tự ẩn sau 15s, có nút × đóng sớm; không đổi logic BLOCK.

1.14.18: Đặt cặp FS ngay dưới toolbar THAY FS, không card riêng. Chuyển FS thành công ghi chung lịch sử. Theo dõi đích dùng tab đã xác minh thay vì tìm lại role giữa reload; khôi phục lượt lỗi tìm Load Balancer ở bước MONITORING_TARGET.

1.14.17: Đặt trước một cặp tắt/bật FS cho lần locked tiếp theo, riêng Col/Sale, dùng một lần và theo hai mode. Cặp đặt trước bỏ qua quy tắc BACKUP; Group ID, CDR/VT, lịch nghỉ và xác minh Save/Reload giữ nguyên. Test giữ local, bỏ khỏi Git.

1.14.16: VT + CDR đủ điều kiện thì BLOCK không chờ nhóm 9s hay yêu cầu CDR mới sau FS khác. Giãn mọi thao tác FreeSWITCH 3s ở hai mode và hai nhóm; dự phòng vẫn 8s.

1.14.15: Dự phòng chờ 8s; tiếp tục đánh giá mỗi cập nhật VT/CDR, không bỏ theo dõi chỉ vì CDR tạm dưới 5/5 khi VT chưa tăng. Tối đa một lượt đổi dự phòng; hai mode giữ nguyên.

1.14.14: FS vừa bật chờ 5s, VT không tăng + CDR mới sau bật đủ 5/5 cho phép BLOCK không cần baseline. Sau đổi số chờ 15s và >=2 mẫu VT mới không tăng, CDR sau đổi vẫn 5/5 thì cho một lượt dự phòng, đúng số ACTIVE mới, tối đa 2 lượt; hai mode giữ nguyên.

1.14.13: Đọc số BACKUP từ bảng tổng quan FreeSWITCH; giữ cache hiển thị khi danh sách số trống/lọc ACTIVE. Cột BACKUP bằng 0 hợp lệ vẫn cập nhật. Cache không dùng xác minh số ACTIVE hay cho phép BLOCK.

1.14.12: Yêu cầu BLOCK tay đã xác nhận giữ ổn định dù VT/CDR dao động; chờ nhóm không xóa popup, khóa nút xác nhận và hiển thị lý do. Đổi số/FS tắt/hủy/OFF/lịch nghỉ vẫn chặn.

1.14.11: Log cảnh báo riêng khi 5 CDR mới liên tiếp 480-30-0, 408-30-0 hoặc 487-32-0 ở FS đang hoạt động; hiện ngay phía trên dashboard, lưu 3 ngày, chống lặp trong cùng đợt. Không dùng các mẫu này để tự BLOCK.

1.14.10: Hiển thị FSxx (số BACKUP còn lại) theo đúng FS/profile từ FreeSWITCH; chưa có dữ liệu hiển thị (—).

1.14.9: Hiển thị lý do/countdown baseline chưa học lại; khôi phục thời điểm bắt đầu đợt VT thấp từ lịch sử khi state cũ thiếu timestamp. Giữ ngưỡng chờ 120s/cửa sổ ổn định 60s và kiểm tra CDR.

1.14.8: Khôi phục học baseline thấp điểm theo cấu hình cũ: đợt giảm >120s, cửa sổ ổn định 60s đủ >=20 mẫu, VT >10, CDR mới không locked; không học từ chuỗi lỗi. Trong nhóm ưu tiên VT thấp, sau xử lý cần CDR 5/5 mới của FS còn lại và VT không hồi để thay tiếp.

1.14.7: State kết hợp VT/CDR: LEARNING khi chưa baseline, WATCHING khi VT <=70%, WARNING khi <=50% hoặc CDR 5/5 chưa đủ VT, SUSPECTED chỉ khi VT <=35% và CDR xác minh. VT thấp không hiện HEALTHY chỉ vì CDR chưa đủ; dữ liệu thiếu/stale có ghi chú. Giữ thao tác và giữ bằng chứng 15s.

1.14.6: Sau Reload on Server thành công tải lại tab Load Balancer để cập nhật trang/khởi động lại đọc VT. Kiểm thử AUTO BLOCK với chuỗi 480-0-0/480-1-0 xen kẽ; bộ đếm tính chung cả hai.

1.14.5: Giảm thời gian ghép bằng chứng CDR 5/5 với VT xuống 15s.

1.14.4: Giữ CDR 5/5 tối đa 30s trong đợt VT giảm (<85% baseline), cho phép CDR xuất hiện trước lúc VT còn <=35%. VT hồi >=85%, đổi số/FS tắt/epoch mới/hết 30s làm bằng chứng hết hiệu lực. Giữ xác nhận tay và khóa xử lý.

1.14.3: Chuỗi 480-1-0 liên tiếp tự đủ điều kiện CDR 5/5; bỏ yêu cầu phải có một 480-0-0. Giữ VT tụt theo baseline, Group ID, xác nhận tay/tự động và chống thao tác lặp.

1.14.2: Giữ bằng chứng CDR 5/5 cho yêu cầu BLOCK xác nhận tay khi VT vẫn thấp và đúng Group ID/số ACTIVE; không đóng popup chỉ vì lượt CDR tiếp theo dưới ngưỡng. Hủy/VT hồi/FS tắt/số đổi/lịch nghỉ/Monitor OFF vẫn chặn. Tự động giữ đánh giá CDR hiện tại.

1.14.1: Giữ hai bảng Collection/Sale xếp dọc, không chuyển sang thẻ khi màn hình nhỏ; kéo ngang xem các cột. Không đổi cơ chế phát hiện/thao tác.

1.14.0: CDR tối thiểu 2s/FS. Mặc định kết hợp VT tụt <=35% baseline và CDR đủ 5/5 trong một lượt, không chờ xác nhận CDR thứ hai. Baseline median 20 mẫu VT 1s, giữ baseline khi tụt. Responsive bảng thành thẻ FS ở <=1000px, đủ các thông tin không kéo ngang.

1.13.7: Search CDR FS tiếp theo không chờ hàng đợi ghi FreeSWITCH; cập nhật bằng timestamp lúc nhận response để không coi dữ liệu bị xếp hàng là mới. Đọc vai trò tab song song. Giữ hai lượt xác nhận, nhịp CDR 3s và khoảng cách ghi.

1.13.6: Reload riêng gọi trực tiếp endpoint apply_changes.php của Load Balancer, kiểm tra lb_reload Success, không phụ thuộc nút trong HTML listing. Toolbar 3 hàng: Monitor/Xóa log, AUTO BLOCK/chế độ BLOCK, Thay FS/chế độ Thay FS.

1.13.5: Nút Reload on Server riêng mỗi nhóm trên dashboard, gọi đúng handler lb_reload của OpenSIPS, chỉ báo thành công khi server trả Success.

1.13.4: Bỏ nút Test BLOCK FS01. Đồng bộ giao diện chọn chế độ Thay FS với BLOCK. Thêm nút số Collection 1–4/Sale 5–7 bật/tắt Group ID có xác nhận, Save + Reload + refresh/xác minh; xanh đang bật, đỏ tắt, xám chưa xác minh. Giữ tự động thay FS riêng.

1.13.3: Nhịp Search CDR tối thiểu 3s/FS để test; hai lượt xác nhận giữ nguyên. Reload cả công cụ Load Balancer và CDR mỗi 30s ở tab nền, giữ đúng vai trò từng tab. Chuỗi 480-0-0/480-1-0 liên tiếp hoặc xen kẽ tính chung, cần ít nhất một 480-0-0.

1.13.2: Chỉ hiển thị 3 dòng CDR. AUTO BLOCK cần hai lượt đọc CDR liên tiếp đủ 5 cuộc: lượt đầu SUSPECTED, lượt kế tiếp còn đủ mới cho đổi số (cả xác nhận tay và tự động). Lượt không đủ/lỗi ngắt xác nhận; refresh dashboard không tính là lượt đọc mới.

1.13.1: Thêm lại VT trên bảng gộp để quan sát; bỏ cột Thông tin/BLOCK và Cuộc gọi/giây. Giữ 5 dòng CDR mới nhất và bộ đếm. Nguồn phát hiện vẫn CDR, cơ chế thao tác không thay đổi.

1.13.0: CDR là nguồn chính phát hiện BLOCK cho Col/Sale; chuỗi 5 cuộc mới 480-0-0/480-1-0 (có 480-0-0), dữ liệu mới tối đa 30s, response tối đa 15s, đúng FS/Group ID/số ACTIVE. VT không kích hoạt SUSPECTED, chặn hành động hay quyết định hồi phục. Sau đổi số dùng CDR mới sau thao tác, giữ một lượt dự phòng sau 15s khi vẫn lỗi. Chế độ xác nhận/tự động, lịch nghỉ và khóa thao tác giữ nguyên. Gộp bảng, bỏ VT/Baseline/Recent/Drop; chỉ hiển thị 5 dòng CDR mới nhất. Chỉ reload CDR mỗi 30s ở tab nền; Load Balancer vẫn đọc Group ID không reload.

1.12.16: Dấu CDR đủ 5/5 tự bỏ sau hai lần đọc dưới ngưỡng cách nhau tối thiểu 5s, hoặc hết 30s khi đang dưới ngưỡng. Dữ liệu quá 15s không hiển thị cảnh báo cũ, báo chờ cập nhật. Giữ lịch sử ghi nhận riêng; không tự kích hoạt BLOCK.

1.12.15: CDR cập nhật DOM tại chỗ, giữ vùng cuộn/ngón tay khi polling; bảng có vùng kéo ngang ở cửa sổ nhỏ. Bảng VT có Đánh giá CDR, lưu lần đủ 5/5 với thời gian và hiển thị riêng số đếm hiện tại. Dấu ghi nhận là lịch sử đối chiếu, không tự BLOCK; đổi số điện thoại sẽ bỏ dấu cũ khi đọc CDR tiếp theo.

1.12.14: Chuỗi CDR mới nhất cho phép xen kẽ 480-1-0 trong 480-0-0, cần ít nhất một 480-0-0 cùng chuỗi; ngưỡng 5, khác mã/Setup ngoài 0-1/Duration khác 0 ngắt chuỗi. Search giữ 5s/FS; AUTO BLOCK vẫn theo VT.

1.12.13: Đọc CDR mỗi tối thiểu 5s/FS; VT giữ nhịp 1s. Reload công cụ không dùng timer trì hoãn; lệnh bị bận Search được xếp lại và thực hiện khi Search hoàn tất. HTML mẫu có 30 cuộc/trang: nhịp 5s chỉ bao phủ khoảng 6 cuộc/s trước độ trễ mạng, cao hơn cần đọc thêm trang.

1.12.12: Thêm cột Cuộc gọi/giây từng FS theo timestamp CDR, hiện giây mới nhất và 5 giây có dữ liệu. Gộp các lần Search bằng Call ID để không đếm trùng, giữ tối đa 60s/2000 ID. Ghi rõ số tối thiểu quan sát được do phân trang; không coi giây không có dữ liệu là 0. Không thay đổi AUTO BLOCK.

1.12.11: Tách bảng CDR thành cột Dãy CDR, Thông tin/BLOCK và Số lần liên tiếp. Vùng dãy số cuộn riêng; bộ đếm ngưỡng 5, cơ chế đọc và AUTO BLOCK giữ nguyên.

1.12.10: Khi có hai tab cùng máy chủ, gán tab mở trước (ID nhỏ hơn) Load Balancer, tab tiếp theo CDR. Alarm 30s reload công cụ ở tab nền; nếu đang sai mục tự chuyển đúng endpoint. Hai máy chủ gán độc lập. Giữ bỏ qua tab đang xem và thao tác đang chạy.

1.12.9: Khôi phục reload thật mỗi 30s cho công cụ Load Balancer/CDR ở tab nền. Reload trực tiếp frame công cụ thay vì main.php để giữ đúng mục; bỏ qua khi đang Search CDR hoặc thay FS. CDR vẫn tự đọc endpoint và tự lấy lại form, không cần chọn lại Destination/IP thủ công. Tab đang xem không tự reload.

1.12.8: Đọc CDR trực tiếp từ endpoint cdrviewer.php qua bất kỳ tab OpenSIPS đã đăng nhập đúng máy chủ. Không bắt buộc mở CDR Viewer; ưu tiên tab CDR nếu có. Tự tải form/hidden fields, cache 60s, lấy lại form và thử lại một lần khi Search lỗi. Không điều hướng tab; AUTO BLOCK vẫn theo VT.

1.12.7: CDR ngưỡng 5 cuộc 480/0/0 liên tiếp. Chế độ đối chiếu đếm cùng các hàng mới nhất đang hiển thị, không loại cuộc cũ hơn 30s; khử trùng Call ID. Chế độ xác minh giữ kiểm tra độ mới, không nhận bằng chứng chỉ quan sát. AUTO BLOCK vẫn theo VT.

1.12.6: Heartbeat 30s đánh thức đọc VT ở tab nền bằng OPENSIPS_POLL_NOW thay vì reload main.php (tránh thay đổi công cụ do phiên server chung hai tab). CDR cũng được đánh thức từ alarm độc lập với mẫu VT. Không điều hướng tab đang xem, giữ hai vai trò Load Balancer/CDR riêng.

1.12.5: Sửa đọc bảng CDR có tiêu đề phân trang lồng bên trong: không dùng tổng số th để loại hàng cuộc gọi. Cột bắt buộc quyết định độ dài hàng. Hiện thông báo số hàng nhận được nếu kết quả rỗng.

1.12.4: CDR hiển thị toàn bộ cuộc gọi trả về đúng IP của FS đang bật, dạng SIP-Setup-Duration, không lọc 480/0/0. Nhịp kiểm tra 1 giây; mỗi nhóm đọc lần lượt tất cả FS, tránh Search chồng nhau; thời gian thực tế phụ thuộc phản hồi server. Hai nhóm đọc độc lập. Bảng mỗi FS có vùng cuộn cho kết quả; AUTO BLOCK vẫn theo VT.

1.12.3: Bảng CDR chỉ hiện FS đang bật theo Group ID (Col=2, Sale=3). Search liên tục luân phiên các FS đang bật, không chờ VT giảm; mỗi nhóm một yêu cầu tại một thời điểm, hai nhóm độc lập. Hiện số cuộc nhận về, bộ SIP/Setup/Duration mới nhất và thời gian cập nhật. CDR chỉ đối chiếu, không quyết định AUTO BLOCK.

1.12.2: Tách CDR thành bảng riêng bên dưới hai bảng VT. Khôi phục polling VT mỗi giây khi trang chưa nhận diện được vai trò; chỉ bỏ qua tab CDR, tránh ngừng VT ở main.php. CDR vẫn chỉ đối chiếu, không quyết định AUTO BLOCK.

v1.12.1 — CDR đối chiếu thử nghiệm, không làm điều kiện AUTO BLOCK
- Cấu hình mới và đã lưu đều cdrObservationEnabled=true, cdrVerificationEnabled=false. AUTO BLOCK/THAY FS giữ các quyết định VT hiện có, kể cả khi CDR chưa đủ 4 hoặc tab CDR lỗi; CDR chỉ Search/hiển thị, kết quả không kích hoạt thao tác.
- Thêm cột CDR vào bảng từng FS: tổng chuỗi mới nhất liên tiếp 480/0/0 (không đếm trùng, không tính Setup 1), đủ 4 hay chưa, thời gian kiểm tra/lỗi, BLOCK đã xác nhận/tay-tự động/đang xử lý/chưa rõ/chưa ghi nhận.
- Lưu cdrBlockOutcome khi trang xác nhận BLOCK thành công, gồm incident, phone, thời điểm, mode và số đếm CDR có sẵn lúc BLOCK. Nếu kết quả CDR đến sau BLOCK ghi rõ, không diễn giải là bằng chứng trước thao tác.
- Nhận kết quả Search đang chạy kể cả thao tác vừa thành công, gắn đúng incident; không để kết quả sự cố cũ ghi đè sự cố mới. CDR không mở lại popup hoặc gọi thêm lượt AUTO trong chế độ đối chiếu.
- Giữ phân biệt tab CDR/Load Balancer, truy vấn nền trên .153 và .155, các timer và giao diện cuộn bảng; tab CDR vẫn cần mở/đăng nhập để đọc được.
- Kiểm thử toàn bộ: 310 tests pass, kiểm tra cú pháp worker/dashboard. Các test chế độ gate giữ riêng để ghép sau, production chưa bật gate.

v1.12.0 — VT + CDR kiểm chứng locked cho cả Col và Sale
- Mở riêng Load Balancer và CDR Viewer trên mỗi host: .153 Collection và .155 Sale (4 tab OpenSIPS khi dùng cả hai nhóm), cùng main.php vẫn được. Role được đọc từ DOM/iframe cùng origin; chỉ tab Load Balancer lấy VT/được refresh và thực hiện thay FS.
- VT đủ nghi ngờ mới Search CDR theo Destination/IP. Search POST dùng form thật và URL của iframe, giữ hidden fields, gửi Search mới, giới hạn ngày hiện tại, chỉ đánh giá INVITE mới trong 30 giây và sau mốc sự cố/thay số; không dùng bảng cũ để xác nhận.
- 4 Call ID khác nhau mới nhất liên tiếp đều SIP 480, Setup Time 0, Duration 0 mới cho phép đổi số/thay FS. 487/200/Setup 1/duration khác 0/giá trị trống ngắt chuỗi. Bằng chứng gắn incident/group/IP/ACTIVE phone, hết hạn 10 giây; Call ID đã dùng không dùng lại.
- Truy vấn nền từng nhóm ngoài messageQueue, không chặn mẫu VT. Một Search đang chạy trên mỗi nhóm; chọn FS luân phiên, truy vấn lại khi kiểm tra cũ >=2 giây. Col/Sale đọc song song. Kết quả trả muộn sau VT hồi/sự cố đổi không được hành động.
- Thiếu tab CDR, nhiều tab cùng role, chưa đủ 4 cuộc, lỗi Search hoặc dữ liệu cũ: WAITING_CDR, giữ cảnh báo, không fallback đổi số theo VT. Xác nhận tay chỉ mở khi đủ điều kiện; chế độ tự động dùng cùng kiểm tra. Các chờ nhóm 9 giây, lịch nghỉ và khóa cũ giữ nguyên.
- FS đích vừa bật không tăng VT cũng cần CDR sau lúc bật trước BLOCK; chưa đủ thì Search lại, tối đa 120 giây trước khi báo cần kiểm tra thủ công. Test BLOCK FS01 chủ động vẫn là test riêng.
- Kiểm chứng: 306 tests pass, kiểm tra cú pháp toàn bộ file mới và worker. Tests dùng DOM/API mô phỏng dựa trên HTML đã cung cấp; chưa kiểm tra trực tiếp trên server nội bộ.
- Sau cập nhật: reload extension, tải lại tab FreeSWITCH/dashboard và các tab OpenSIPS; giữ mỗi host đúng 1 tab Load Balancer + 1 tab CDR Viewer, đăng nhập cùng phiên trình duyệt.

v1.11.22 — Kiểm tra VT hồi trước lượt AUTO BLOCK đầu tiên, baseline 20 mẫu
- Baseline Col/Sale 20 mẫu, chu kỳ 1 giây (~20 giây), cập nhật cả config lưu cũ qua getState.
- Trước xử lý primary: xét 4–6 mẫu thấp liên tiếp mới nhất, trải ít nhất 3 giây. Trung vị nửa cuối tăng ít nhất max(2 VT, 5%) so nửa đầu, mẫu cuối không dưới trung vị nửa cuối, 2 mẫu cuối không giảm quá 5% so 2 mẫu trước: giữ WARNING và hủy yêu cầu đổi số chưa thực hiện, giữ baseline cũ.
- Gate kiểm tra lại ngay trước đổi số/thay FS, loại ứng viên đang hồi khỏi thứ tự ưu tiên. Áp dụng xác nhận tay/tự động và nhóm một FS. Không mở khóa số đã xử lý hoặc đổi logic dự phòng.
- Chỉ hoãn trong lúc xu hướng hồi đạt điều kiện; VT đứng thấp hoặc tăng 1–2 nhịp rồi giảm vẫn xét SUSPECTED theo ngưỡng cũ. Khoảng quan sát sau lượt xử lý vẫn 9 giây.
- 274 kiểm thử đạt: 600 xuống 100 rồi hồi có dao động trước lượt đổi đầu ở Col/Sale × tay/tự động, tụt lại sau hồi, nhịp tăng ngắn không che lỗi.

v1.11.21 — Quan sát nhóm 9 giây
- Tăng groupObserveMs từ 6000 lên 9000 cho Col/Sale, cả AUTO và xác nhận tay, gồm bước bật FS đích trong THAY FS. Cấu hình lưu cũ cũng được cập nhật.
- Cửa sổ học mức VT hồi nhóm được mở rộng đủ 9 giây thực với chu kỳ 1 giây; không chỉ tăng timer khiến cửa sổ 8 mẫu mãi không đủ dài.
- Giữ theo dõi đích 5 giây, dự phòng tối thiểu 15 giây và hai nhóm độc lập. Nhóm một FS không tạo thời gian quan sát peer.
- 269 kiểm thử đạt, cập nhật kiểm tra không có popup/đổi FS tiếp trong 8 giây đầu, xét lại từ 9 giây với VT mới.

v1.11.20 — Chặn popup xác nhận cũ trong khoảng quan sát nhóm
- Sau CONFIRM_AUTO_BLOCK, dọn ngay yêu cầu peer bị group gate chặn trước khi trả phản hồi. GET_STATE cũng loại yêu cầu đã khóa/hết hợp lệ/đang chờ nhóm, không chạy thao tác tự động khi đọc.
- Dashboard tự chặn popup cùng nhóm trong 6 giây và khi chưa có 2 mẫu mới; bỏ snapshot trả về muộn từ render cũ sau thao tác xác nhận hoặc render mới hơn.
- Nhóm khác vẫn độc lập. Hết chờ, worker đánh giá VT mới rồi mới tạo yêu cầu, không chỉ mở lại theo đồng hồ.
- 269 kiểm thử đạt, thêm xác nhận tay liên tiếp 1 giây, snapshot cũ trả về muộn, timer hết nhưng thiếu mẫu mới.

v1.11.19 — Ưu tiên VT thấp nhất, chấp nhận nhịp tăng xen kẽ
- Ứng viên đủ điều kiện nghi block trong cùng nhóm: VT hiện tại thấp nhất trước; khi bằng nhau dùng xu hướng giảm tổng thể 6 mẫu gần nhất (so trung vị hai nửa), rồi backup ít hơn nếu THAY FS bật, thời điểm và tên FS.
- Không còn yêu cầu từng mẫu giảm liên tục. Dùng chung lựa chọn cho AUTO, xác nhận tay và THAY FS; giữ quan sát nhóm 6 giây, lấy VT 1 giây và kiểm tra hồi giả của v1.11.18.
- Kiểm thử VT thấp đứng yên được chọn trước VT cao giảm đều, cùng VT thì giảm tổng thể có hai nhịp tăng vẫn được ưu tiên. Toàn bộ 266 kiểm thử đạt.

v1.11.18 — VT mỗi giây, theo dõi hồi giả sau xử lý nhóm
- OpenSIPS poll 1 giây (giữ busy chống request chồng), sampleIntervalMs 1000 áp dụng cả cấu hình lưu. Baseline 15 mẫu tương đương ~15 giây; các timer cooldown, nghỉ, 6 giây quan sát nhóm, 5 giây theo dõi đích, 15 giây dự phòng giữ nguyên.
- Hồi nhóm: hai mẫu cuối phải còn trên mức trước xử lý và trung vị không giảm quá 5% so với hai mẫu liền trước. Không học baseline hồi nếu cửa sổ 8 mẫu chưa kéo dài ít nhất 6 giây hoặc nửa cuối giảm hơn 5% so với nửa đầu.
- Nếu nhịp tăng giả rồi tụt lại, bỏ chặn hồi nhóm và xét FS chưa xử lý còn đủ điều kiện thấp. FS đã xử lý giữ khóa/luồng phục hồi riêng, không đổi lặp.
- Kiểm thử lấy mẫu 1 giây ở Col/Sale và cả hai chế độ, tăng rồi tụt: chỉ xử lý FS tiếp theo sau 6 giây, không lặp lại FS trước.

v1.11.17 — Quyết định nghi block theo VT mới và hồi nhóm
- VT hiện tại vượt 35% baseline chặn đổi số/thay FS dù median cũ còn thấp. Loại ứng viên đó khỏi thứ tự xử lý để không giữ lượt FS khác.
- SUSPECTED chưa xử lý: khi VT hiện tại và recent median đều vượt ngưỡng thấp, hủy yêu cầu đổi số, chuyển WARNING/WATCHING; giữ baseline để phát hiện tụt lại.
- Hồi nhóm dùng 2 mẫu mới cùng tăng so với VT lúc xử lý FS trước, so với đỉnh 4 mẫu gần nhất thay vì đỉnh toàn bộ quá khứ. Giữ chờ 6 giây và điều kiện ổn định 8 mẫu trước khi học baseline mới.
- Học mức hồi nhóm áp dụng cả WARNING/WATCHING sau khi hủy nghi ngờ. Không mở khóa thao tác đã gửi hoặc kết quả chưa rõ.
- Kiểm thử Col/Sale, trường hợp đỉnh thoáng qua, tụt lại, FS05/FS07 chạy với FS06 tắt (VT còn treo), cả xác nhận tay và tự động.

v1.11.16 — Học baseline 15 mẫu
- Tăng baseline Col và Sale từ 10 lên 15 mẫu, giữ chu kỳ 2 giây (~30 giây). Áp dụng cấu hình đã lưu; giữ nguyên ngưỡng SUSPECTED và thời gian phục hồi.

v1.11.15 — Học baseline 10 mẫu
- Col và Sale học baseline từ 10 mẫu VT, giữ chu kỳ 2 giây (~20 giây). Áp dụng cả cấu hình đã lưu; giữ nguyên ngưỡng SUSPECTED và thời gian phục hồi.

v1.11.14 — Col/Sale chạy xen kẽ, xóa log theo ngày và khung giờ
- Khoảng quan sát 6 giây chỉ áp dụng cùng nhóm. Hai nhóm đổi số có thể cách nhau 2 giây; vẫn chờ phản hồi thao tác trước khi ghi tiếp, không bấm đồng thời.
- Theo dõi VT FS đích sau Thay FS chạy qua timer riêng, không giữ hàng đợi trong 5 giây. Có thể bật/tắt FS của nhóm khác trong lúc chờ; lưu deadline/pending theo operation, alarm/TICK tiếp quản nếu worker bị suspend.
- Clear history mở dialog chọn ngày/giờ Việt Nam; chỉ xóa events trong khoảng chọn (bao gồm phút kết thúc). Thiếu hoặc sai khoảng thời gian bị từ chối. Không đổi incident/baseline/khóa hay chạy AUTO chỉ vì xóa log.
- Giữ eventKeys chống ghi lại log sự cố đã xử lý. Mở khóa operation cũng hủy bước theo dõi VT đang chờ của lượt đó.

v1.11.13 — Xử lý nghi block từng FS, quan sát nhóm 6 giây
- Col FS01–04 và Sale FS05–07: khi nhiều FS cùng SUSPECTED, ưu tiên VT giảm liên tục rồi VT hiện tại thấp nhất. Khi ngang VT và THAY FS bật, dùng BACKUP ít hơn để phân xử; vẫn giữ phạm vi/điều kiện chuyển FS cũ.
- Sau một lượt đổi số thành công, lưu mốc quan sát nhóm 6 giây và VT của các FS còn lại. Không xử lý FS tiếp theo cho tới hết khoảng chờ và có ít nhất 2 mẫu VT mới; dùng chung khoảng cách ghi 5 giây, không cộng thêm chờ 20 giây HEALTHY.
- FS còn lại có VT tăng và giữ được mức hồi được tạm bỏ qua; đủ mẫu ổn định thì học baseline mới và đóng nghi ngờ mà không đổi số. Chưa hồi thì xử lý ứng viên tiếp theo, không lặp lại FS vừa xử lý.
- BLOCK dự phòng nhường lượt cho các FS nghi block chưa xử lý trong nhóm. Các nhóm quan sát độc lập; mốc chờ tồn tại qua restart worker. Áp dụng tự động và thứ tự xác nhận tay.
- Thay FS OpenSIPS bắt đầu cửa sổ quan sát nhóm sau xác minh bật đích, chạy chung với bước theo dõi VT đích 5 giây; lỗi tiền kiểm nguồn không làm các ứng viên khác bị chặn mãi.

v1.11.12 — Sale học baseline được với VT thấp; phân biệt FS tắt với đang học
- Khởi tạo/học lại baseline Sale dùng mẫu VT > 0, median >= 4 sau đủ 20 mẫu, tương thích ngưỡng phục hồi Sale. Trước đây yêu cầu 20 mẫu liên tiếp > 10 khiến VT 4–10 mãi INACTIVE.
- Dashboard: Group ID đang chạy nhưng baseline chưa sẵn sàng hiển thị LEARNING (VT dương), WAITING_VT (VT 0), PAUSED (nghỉ theo lịch); thiếu Group ID hiển thị UNKNOWN_GROUP. INACTIVE cho FS đã tắt/sai nhóm.
- Giữ gate Group ID và điều kiện phát hiện block: chưa học đủ baseline không tạo SUSPECTED. Collection giữ ngưỡng hiện có.

v1.11.11 — Giảm chờ VT sau bật FS xuống 5 giây
- Áp dụng Col/Sale và cả hai mode. Kiểm tra VT sau khoảng 2, 4, 5 giây; nhịp cuối giới hạn theo deadline để không chờ tới 6 giây.
- Không tăng VT thì kiểm tra lại và BLOCK số đích; vẫn giữ khoảng cách ghi FreeSWITCH 5 giây nếu có thao tác khác vừa chạy.

v1.11.10 — Reload thật qua MI lb_reload, đọc số ACTIVE trực tiếp sau khi chờ VT
- Nút Reload CP 8.3.2 onclick apply_changes() gọi GET apply_changes.php. Không submit giả nút type=button. Phải nhận Sending MI command: lb_reload / Sending to ... : Success trước khi xác minh Group ID và tải lại trang.
- Save/Group ID đã đổi không đủ để báo thành công nếu MI Reload thất bại hoặc thiếu xác nhận.
- Sau 8 giây VT không tăng, đọc trực tiếp danh sách số trên tab FreeSWITCH trước BLOCK. Tránh bị chặn do snapshot cũ trong lúc worker đang giữ hàng đợi thay FS; vẫn xác minh đúng một ACTIVE khớp số đích.
- Áp dụng cả Col/Sale, xác nhận tay/tự động. Thiếu VT/Group ID hoặc MI lỗi vẫn dừng và hiện lỗi.
- Nguồn đối chiếu CP 8.3.2: https://github.com/OpenSIPS/opensips-cp/blob/8.3.2/web/tools/system/loadbalancer/lib/loadbalancer.main.js và apply_changes.php cùng thư mục loadbalancer.

v1.11.9 — Theo dõi VT đích 8 giây trước khi đổi số
- Cả Col/Sale và mode tay/tự động: đọc VT trước khi bật đích, Save/Reload/refresh/xác minh, lấy VT trực tiếp từ OpenSIPS mỗi 2 giây trong 8 giây.
- Có VT tăng so với trước bật: không BLOCK. Không tăng: kiểm tra lại Group ID, VT, số ACTIVE và khoảng cách thao tác 5 giây rồi BLOCK đúng số của đích một lần; chỉ ghi COOLDOWN/log thành công khi trang xác nhận.
- Dữ liệu thiếu, MONITOR tắt, lịch nghỉ hoặc thao tác bị gián đoạn: giữ lỗi/khóa để kiểm tra, không tự gửi lại BLOCK. Các FS khác vẫn tiếp tục AUTO BLOCK sau lượt này.

v1.11.8 — Thay FS chỉ đổi Group ID, không BLOCK số đích
- Cả mode tay/tự động: tắt nguồn → Save/Reload/refresh/xác minh → bật đích → Save/Reload/refresh/xác minh → hoàn tất. Không gửi ACTIVE → BLOCKED cho FS vừa bật, không tạo incident đổi số/COOLDOWN hoặc log AUTO_BLOCKED giả cho đích.
- Đích học baseline từ VT thực tế. Các FS đang chạy khác vẫn được AUTO BLOCK xử lý sự cố bình thường; khoảng chờ BLOCK dự phòng cùng nhóm sau rotation vẫn giữ.
- Ví dụ FS05/06 cùng SUSPECTED, BACKUP 10/6, FS07 tắt BACKUP 11: thay FS06 → FS07 trước, FS05 tiếp tục luồng đổi số theo chế độ AUTO BLOCK.

v1.11.7 — Ưu tiên thay FS nguồn ít BACKUP nhất
- Sắp xếp kế hoạch đủ điều kiện theo BACKUP nguồn tăng dần, không phụ thuộc thứ tự dòng OpenSIPS. Áp dụng danh sách xác nhận tay và lượt chạy tự động.
- Ví dụ Sale FS05 = 10, FS06 = 6 đều SUSPECTED và FS07 = 11 đang tắt: FS06 → FS07 đứng đầu.
- Khi bằng BACKUP, giữ thứ tự ổn định theo nhóm rồi tên FS. FS đích vẫn chọn BACKUP nhiều nhất trong cùng nhóm đang tắt.

v1.11.6 — Chờ nhóm ổn định tải sau Thay FS trước khi BLOCK dự phòng
- Áp dụng cả xác nhận tay và tự động: lượt đổi số bình thường vẫn tiếp tục; lượt BLOCK dự phòng của cùng nhóm chờ thao tác Thay FS hoàn tất.
- Sau DONE, chờ 30 giây rồi lấy đủ 8 mẫu VT mới (thông thường thêm khoảng 16 giây) để đánh giá lại; bỏ mẫu trong thời gian đổi FS/chia tải. VT ổn định dù thấp học baseline mới, không BLOCK dự phòng.
- Kiểm tra lại cả lượt dự phòng đã vào hàng chờ trước khi gửi ACTIVE → BLOCKED hoặc đề xuất Thay FS. Nhóm Col/Sale độc lập.
- Dựa trên operation/history đã lưu nên reload worker vẫn giữ khoảng chờ. Nếu thay FS lỗi/gián đoạn, chờ người dùng kiểm tra và mở khóa rồi mới đánh giá lại.
- Đổi số không liên quan tới Thay FS vẫn giữ thời gian dự phòng 15 giây hiện có.

v1.11.5 — Không che SUSPECTED và không để lỗi Thay FS làm dừng AUTO BLOCK khác
- GET_STATE dựng lại alerts từ trạng thái FS hiện tại và ghi rõ lý do xử lý/chặn từng FS. Banner không hiện No suspected khi vẫn có hàng SUSPECTED.
- FS BACKUP <= 10 có kế hoạch hợp lệ: mode tay hiện chờ xác nhận THAY FS; mode tự động hiện chờ lượt/lỗi tiền kiểm. Không giữ FS chỉ vì dữ liệu rotation cũ khi chưa có kế hoạch hợp lệ.
- Bắt lỗi tiền kiểm Thay FS (ví dụ thiếu tab) để các FS khác tiếp tục AUTO BLOCK; giữ cảnh báo nguồn cùng lỗi, không bỏ qua âm thầm.
- Không có đích nghỉ đủ điều kiện: AUTO BLOCK theo chế độ hiện tại tiếp tục trên nguồn. Không tự bỏ khóa kết quả chưa xác minh.

v1.11.4 — Chẩn đoán điều kiện chuyển FS ở ngưỡng BACKUP 10
- Giữ BACKUP_THRESHOLD = 10 do người dùng chỉnh. Điều kiện vẫn là lượt nguồn SUSPECTED chưa khóa, không thay chỉ vì BACKUP thấp khi HEALTHY/RECOVERING.
- Trang Thay FS hiển thị điều kiện từng FS: count BACKUP, Group ID, State và lý do thiếu điều kiện (OFF, mode tay chờ xác nhận, lịch nghỉ, dữ liệu cũ, incident/test còn khóa hoặc đích không phù hợp).
- Ngưỡng hiển thị lấy từ module thay vì một giá trị UI riêng. Đích phải Group ID 0 cùng nhóm và BACKUP > nguồn, đúng một ACTIVE có điều khiển.
- Không đổi thứ tự tắt nguồn trước rồi bật đích mà người dùng đã sửa trong code; không suy đoán trạng thái thực trên máy chủ khi chưa có snapshot.

v1.11.3 — Thứ tự chuyển FS theo yêu cầu
- Chỉ xét khi nguồn SUSPECTED, trước BLOCK nguồn; HEALTHY không chuyển.
- Có đích hợp lệ và nguồn BACKUP <= 10: tắt nguồn (2/3 -> 0), Save + Reload + refresh xác minh; bật đích (0 -> 2/3), Save + Reload + refresh xác minh; cuối cùng ACTIVE -> BLOCKED chỉ số của đích.
- Lỗi ở bất kỳ bước nào giữ khóa và dừng, không BLOCK nguồn hoặc tự lặp. Xác nhận tay chờ xác nhận; tự động chạy trọn lượt.

v1.11.2 — Ngưỡng Thay FS 10 và tiếp tục đổi số khi chưa có đích
- Sửa một chỗ BACKUP_THRESHOLD trong fs-switch.js để đổi ngưỡng (hiện tại 10).
- Không có đích hợp lệ: AUTO BLOCK nguồn tiếp tục theo chế độ hiện tại; không đánh dấu lượt tìm đích là đã xử lý.
- Mỗi lần xét nghi block đều đọc lại BACKUP/đích; nếu đích được bổ sung BACKUP và đủ điều kiện thì ưu tiên chuyển FS. Giữ khóa cooldown/recovery, không ghi lặp trong cùng sự cố.

v1.11.1 — Gộp Thay FS vào dashboard
- Nút THAY FS ON/OFF cùng thanh MONITORING và AUTO BLOCK; chọn xác nhận tay hoặc tự động, xác nhận lượt chuyển ngay trên dashboard.
- Áp dụng quy tắc cũ cho Collection FS01–04 và Sale FS05–07, không giới hạn test FS03/FS04. FS08–10 giữ phạm vi hệ thống ngoài.
- BACKUP nguồn <= 6; đích cùng nhóm Group ID 0/trống, BACKUP nhiều nhất và lớn hơn nguồn, đúng một ACTIVE. Bật đích, tắt nguồn, sau đó BLOCK số ACTIVE đích.
- Mỗi thay đổi OpenSIPS phải Save + Reload + tải lại trang và xác minh. Lỗi giữ khóa, không tự lặp.
- Trang chi tiết giữ test OpenSIPS tùy chọn; không cần vào trang đó để bật/tắt Thay FS.

v1.10.6 — Tự refresh tab OpenSIPS sau đổi Group ID
- Sau Save + Reload + xác minh server, worker refresh tab OpenSIPS (bypass cache), chờ tải xong và đọc Group ID từ content script mới.
- Page ID riêng mỗi lần tải giúp không nhận nhầm phản hồi trang cũ. Chỉ DONE sau khi trang mới xác minh đúng Group ID; timeout/sai giá trị không tự lặp Save.
- Bật và tắt đều dùng hàng rào refresh/xác minh trước bước tiếp theo. Luồng đầy đủ vẫn đang khóa; test vẫn chỉ FS03/FS04, không FreeSWITCH.

v1.10.5 — Sửa bước nhận diện Reload sau Save và kết quả test
- Nhận diện Reload dạng input submit/button/image, button/link; ưu tiên value trên input.
- Nếu phản hồi Save không có Reload, GET lại trang Load Balancer để lấy form Reload thật, không gửi Save lại.
- Chỉ thành công sau Reload và Refresh xác minh Group ID. Lỗi ghi rõ đã Save nhưng chưa Reload hoặc đã gửi Reload nhưng chưa xác minh.
- Popup test đóng cả khi lỗi để hiện kết quả ngay, không cần Hủy + refresh. Không tự lặp xác nhận đã dùng.
- Vẫn chỉ test FS03/FS04 trên OpenSIPS, không FreeSWITCH; AUTO BLOCK các FS khác giữ ON được.

v1.10.4 — Test FS03/FS04 khi AUTO BLOCK ON
- Không yêu cầu tắt AUTO BLOCK. Trước khi ghi Group ID, giữ FS đang test ngoài detector/hàng đợi BLOCK; các FS khác tiếp tục bình thường.
- Khóa test lưu qua khởi động lại. Sau test tắt 2 → 0 thành công, chỉ bỏ khóa khi mẫu OpenSIPS xác nhận Group ID 0; lỗi giữ khóa để không BLOCK số đang test.
- Vẫn chỉ OpenSIPS FS03/FS04, không gọi FreeSWITCH; luồng thay FS đầy đủ vẫn khóa.

v1.10.3 — Chỉ mở test OpenSIPS FS03/FS04
- Gỡ trạng thái disabled âm thầm của nút test; nút bấm được và hiện rõ lý do khi AUTO BLOCK đang ON. Lỗi không bị refresh định kỳ xoá/ghi đè.
- UI chỉ hiển thị test 0 ↔ 2 cho FS03/FS04. Worker khoá bật/xác nhận chuyển FS đầy đủ, cưỡng chế cài đặt Thay FS cũ về OFF; alarm không chạy chuyển đầy đủ.
- Content script chỉ nhận ghi Group ID cho Collection FS03/FS04 trong giai đoạn này. Save + Reload + xác minh; không gọi FreeSWITCH.
- Tắt AUTO BLOCK trước khi thử để tránh luồng tự động xử lý số trên FS vừa bật. Refresh extension, dashboard và tab OpenSIPS trước khi dùng nút mới.

v1.10.2 — AUTO BLOCK xác định FS đang hoạt động bằng Group ID OpenSIPS
- Collection chỉ xử lý khi Group ID 2; Sale khi Group ID 3. Group ID 0 hoặc sai nhóm: đưa FS về INACTIVE, huỷ incident/preview đang chờ, không phụ thuộc VT còn treo.
- Khi Group ID chưa biết hoặc dữ liệu cũ: không phát hiện/khôi phục/BLOCK; cần đọc Group ID mới. Kiểm tra cả trước thao tác và lúc giữ hàng đợi.
- Tắt FS khi đang RECOVERING đóng chuỗi cũ, không phát sinh BLOCK dự phòng khi VT giảm về 0; vẫn giữ incident cũ trong audit. Bật lại học baseline mới.
- Dashboard hiển thị Group ID và giải thích FS tắt nhưng VT còn treo. Reload extension và refresh các tab OpenSIPS để nạp parser mới.
- Thao tác FreeSWITCH vẫn ACTIVE → BLOCKED, không chuyển ACTIVE → BACKUP.

v1.10.1 — Test bật/tắt OpenSIPS riêng
- Trang Thay FS có khung Test OpenSIPS, chọn FS03 (.184) hoặc FS04 (.180), nút bật 0 → 2 và tắt 2 → 0.
- Preview đọc Group ID thực tế từ Refresh from Server, không ghi. Xác nhận có hiệu lực 60 giây và chỉ dùng một lần.
- Chỉ Edit Group ID → Save → Reload on Server → Refresh xác minh. Không gọi FreeSWITCH, không yêu cầu tab FreeSWITCH.
- Test yêu cầu Thay FS OFF và AUTO BLOCK OFF; có thể thử tay ngoài lịch nghỉ và khi MONITOR OFF. Không dùng VT làm điều kiện.
- Lưu kết quả test riêng; lỗi/gián đoạn không tự lặp. Reload extension và refresh tab OpenSIPS để nạp content script mới trước khi thử.

v1.10.0 — Thay FS thử nghiệm riêng, chưa ghép AUTO BLOCK
- Mở liên kết “Thay FS · riêng” trên dashboard. Mặc định OFF, chế độ xác nhận tay; có chế độ tự động với xác nhận bật chế độ.
- Chỉ cho bật khi AUTO BLOCK OFF; chặn bật AUTO BLOCK khi Thay FS đang ON để tránh chạy đồng thời. Giữ MONITOR ON và lịch làm việc.
- Chỉ xét Collection FS01–04 / Group ID 2 và Sale FS05–07 / Group ID 3. Group ID 0/trống là đích chưa bật, không xét VT đích.
- Khi nguồn SUSPECTED, BACKUP <= 6 (lượt đổi số kế tiếp chạm 5), chọn đích cùng nhóm nhiều BACKUP nhất, lớn hơn nguồn, đúng một số ACTIVE.
- Bật đích bằng form Edit thực tế → Save → Reload on Server → Refresh xác minh; tắt nguồn theo cùng thứ tự; cuối cùng ACTIVE → BLOCKED cho số đích. Không BLOCK nguồn.
- Lưu trạng thái từng bước và lịch sử riêng. Lỗi/worker khởi động lại giữa thao tác: dừng, giữ khóa, không tự lặp. Tắt Thay FS và kiểm tra/khắc phục thủ công trước khi bấm mở khóa.
- Automatic được đánh giá mỗi 30 giây bằng alarm; khi mở trang riêng kiểm tra mỗi 10 giây. Không có đích phù hợp thì không thao tác, không rơi về BLOCK nguồn.
- Adapter đọc form/link của OpenSIPS, giữ nguyên các trường ngoài Group ID; không đoán API. Nếu trang dùng handler JavaScript không nhận diện được thì dừng và yêu cầu kiểm tra HTML, chưa xác nhận tương thích trực tiếp máy chủ thật.
- FreeSWITCH dùng thao tác trạng thái đã có, thành công theo phản hồi/trạng thái trang, chưa kiểm chứng độc lập giao dịch backend.

v1.9.31 — Bỏ reset/học lại baseline riêng lúc 11:30. Sale dùng phát hiện bình thường đến 11:40, nghỉ 11:40–13:00. Ngưỡng SUSPECTED vẫn 35% baseline: baseline 500 thì 200 chưa đủ, 100 có thể đủ nếu giảm kéo dài.

v1.9.30 — Sale 11:30–11:40 giảm tải: vẫn giám sát, học baseline mới để không so VT 80–100 với baseline 500. Sale nghỉ từ 11:40–13:00; Collection giữ 12:10–13:00. Cập nhật cấu hình đã lưu khi nâng cấp.

v1.9.29 — Khung log responsive giữ chiều cao 8 dòng khi đổi trang; ô ngày/giờ riêng. Phân trang số có dấu …, luôn có trang đầu/cuối, nhập số để nhảy trang; không tạo toàn bộ nút khi nhiều trang.

v1.9.28 — Bỏ khung FS NGHI NGỜ BỊ BLOCK; lịch sử chỉ hiển thị lượt BLOCK thành công, mỗi sự cố một log. Giữ thống kê theo FS, lọc ngày, phân trang 8 log và lưu 3 ngày.

v1.9.27 — Thống kê và lịch sử
- Mặc định lọc hôm nay theo giờ Việt Nam; chọn ngày hoặc Tất cả ngày.
- Tổng lượt xử lý BLOCK thành công theo FS, không tính test/lỗi/đang chờ; một sự cố chỉ tính một lần, lượt dự phòng tính riêng.
- Phân trang 8 log, giữ toàn bộ log trong 72 giờ thay vì giới hạn 200 log. Log quá hạn tự xoá khi worker đọc/cập nhật; không xoá khóa sự cố.
- Thống kê ghi nhận thao tác/trạng thái BLOCKED, không khẳng định số thay thế đã chạy thành công. Không khôi phục log đã bị bản cũ xoá.

v1.9.26 — BLOCK dự phòng khi VT chưa hồi phục
- Sau lần BLOCK đầu, chờ ít nhất 15 giây và đủ 8 mẫu VT thấp không tăng; nếu vẫn chưa hồi phục, mở tối đa một lượt dự phòng.
- Chỉ nhắm đúng một số ACTIVE mới cùng FS/profile, với số cũ vẫn BLOCKED trên dữ liệu FreeSWITCH mới. Không BLOCK lại số cũ.
- Tự động thực hiện ở chế độ AUTOMATIC; chế độ MANUAL vẫn yêu cầu xác nhận, ghi rõ lần 2/2.
- Mỗi thao tác giữ SUSPECTED đến khi trang phản hồi thành công. Giữ khoảng cách 5 giây, lịch nghỉ, MONITOR OFF, AUTO OFF và khóa kết quả không chắc chắn.
- Tối đa hai lượt trong một chuỗi chưa hồi phục; chỉ khi thực sự HEALTHY mới cho phép chuỗi mới. Lưu chuỗi qua khởi động lại.
- Thành công hiện dựa vào phản hồi/trạng thái trên trang FreeSWITCH, không phải kiểm chứng độc lập giao dịch backend.

V1.9.24 — chỉ hiện lịch nhóm đang nghỉ
- Theo yêu cầu, ẩn lịch nhóm đang trong giờ giám sát hoặc chưa có dữ liệu lịch.
- Chỉ hiện Sale từ 17:00, Collection từ 18:00 và thông báo nghỉ trưa tương ứng.
- Lịch hoạt động và detection không đổi. Reload extension rồi refresh dashboard.

V1.9.23 — hiện lịch cả Collection và Sale
- Dashboard luôn có trạng thái lịch của cả hai nhóm; trước đây chỉ hiện nhóm đang nghỉ nên 17:00–18:00 chỉ thấy Sale.
- Collection: trong giờ giám sát tới 18:00, sau đó dừng 18:00–09:00. Sale: dừng 17:00–09:00.
- Nếu MONITORING tắt tay, hiển thị rõ thay vì ghi đang giám sát. Không thay đổi lịch hay detection.
- Reload extension rồi refresh dashboard để cập nhật.

V1.9.22 — Collection hồi phục ở tải 15–17
- Collection giảm median tối thiểu cho RECOVERING từ 50 xuống 11 (collectionRecoveryTrafficFloor). Từng mẫu vẫn phải VT > 10.
- Giữ 8 mẫu, ổn định liên tục 10 giây, cooldown 30 giây và kiểm tra range/trend.
- VT 15–17 ổn định có thể HEALTHY và học baseline mới thay cho baseline cũ 400.
- VT = 0, mẫu <=10 hoặc còn biến động mạnh vẫn giữ khóa.
- Sale và lịch làm việc không đổi. Reload extension, refresh dashboard để áp dụng.

V1.9.21 — lịch ngừng qua đêm đến 09:00
- Sale: nghỉ 17:00–09:00 hôm sau. Collection: nghỉ 18:00–09:00 hôm sau. Giờ Việt Nam, áp dụng hằng ngày.
- Trong khung nghỉ vẫn đọc VT; không detection/BLOCK/yêu cầu xác nhận. Đóng yêu cầu chưa thực hiện khi bắt đầu nghỉ.
- Một khung nghỉ liên tục qua 00:00, không reset giả ở nửa đêm.
- 09:00: học lại baseline trước giám sát. MONITORING tắt tay vẫn OFF; khóa những thao tác đã thực hiện vẫn giữ.
- Lịch nghỉ trưa giữ nguyên: Sale 11:30–13:00; Collection 12:10–13:00.
- Reload extension và refresh dashboard/FreeSWITCH để áp dụng.

V1.9.20 — Sale dừng từ 17:00 (giờ Việt Nam)
- Sale 99.155: thêm khung dừng từ 17:00 đến hết ngày, không detection/BLOCK/popup xác nhận. Vẫn thu thập VT.
- Đóng yêu cầu chưa thực hiện khi vào khung dừng; xác nhận cũ bị từ chối. Khóa thao tác đã thực hiện giữ nguyên.
- Lịch nghỉ trưa Sale 11:30–13:00 và Collection 12:10–13:00 giữ nguyên. Collection không dừng lúc 17:00.
- Lịch là hằng ngày: sau hết ngày, cơ chế ngoài khung nghỉ tiếp tục, học baseline mới; chưa cấu hình giờ bắt đầu ca sáng riêng.
- Reload extension, refresh dashboard và FreeSWITCH để áp dụng.

V1.9.19 — SUSPECTED chỉ hoàn tất sau trạng thái BLOCKED
- Giữ SUSPECTED và cảnh báo trong lúc chờ/gửi. Khóa chống lặp vẫn được lưu trước gửi nhưng không chuyển COOLDOWN sớm.
- Khi nhận kết quả BLOCKED: đánh dấu autoExecuted, bắt đầu cooldown từ thời điểm xác nhận.
- Timeout/mất kết nối: vẫn SUSPECTED + cần kiểm tra, không tự hồi phục/mở khóa chỉ dựa vào VT.
- Quan sát đúng số cũ của FS/profile đã BLOCKED sau xử lý tay thì đồng bộ sang COOLDOWN. BLOCKED của FS khác không đóng sự cố.
- GET_STATE có thể đọc snapshot đang gửi để dashboard hiện Đang chuyển, chưa hoàn tất.
- Sửa hiển thị log để phân biệt chờ, đang gửi, chưa rõ và đã BLOCKED. Chuyển trạng thái cũ chưa có kết quả thành công về SUSPECTED khi tải state.
- Kết quả quan sát theo trang FreeSWITCH, chưa có xác nhận transaction độc lập từ backend.
- Reload extension và refresh FreeSWITCH/dashboard để áp dụng.

V1.9.18 — AUTO cách 5 giây theo yêu cầu
- Giảm freeSwitchAutomaticGapMs từ 10000 xuống 5000, cập nhật cả cấu hình 10 giây đã lưu.
- Giữ xử lý từng FS, cập nhật dữ liệu và cho phép tắt AUTO giữa các lượt.
- Kiểm thử 3/5 FS đồng thời với backend mô phỏng giao dịch 4 giây. Không khẳng định giao dịch lâu hơn 5 giây sẽ không chồng nhau.
- Reload extension rồi refresh dashboard/FreeSWITCH để áp dụng.

V1.9.17 — AUTO chờ 10 giây, xử lý từng lượt không chặn dữ liệu
- Riêng Tự động: cách ít nhất 10 giây sau phản hồi DOM của lần trước; xác nhận tay/Test vẫn cách tối thiểu 5 giây.
- AUTO không sleep trong cả batch: FS còn lại chờ timestamp, được kiểm tra lại trên sample tiếp theo. Dữ liệu mới và thao tác tắt AUTO vẫn được xử lý giữa các lượt.
- Dashboard hiện Chờ lượt AUTO cho FS đang xếp hàng.
- Kiểm thử 3 và 5 Sale đồng thời với backend mô phỏng giao dịch 8 giây; không có ghi chồng.
- Đây là giảm tốc gửi để hạn chế tranh chấp SQLite; vẫn chưa có tín hiệu xác nhận transaction backend hoàn tất. Nếu backend giữ transaction mở, cần sửa phía server.
- Reload extension và refresh FreeSWITCH/dashboard để áp dụng.

V1.9.16 — giãn ghi trạng thái FreeSWITCH tránh giao dịch SQLite chồng nhau
- Mọi thao tác trạng thái từ extension (AUTO, xác nhận tay, Test FS01) được xử lý lần lượt và chờ ít nhất 5 giây sau kết quả lần trước trước khi gửi lần tiếp.
- Lưu freeSwitchNextActionAt trước/sau gửi để worker restart vẫn giữ khoảng chờ.
- Sau thời gian chờ, kiểm tra lại lịch nghỉ, độ mới dữ liệu và sự cố trước khi gửi AUTO.
- Không thay đổi ngưỡng detection hoặc khóa mỗi sự cố một lần.
- Kiểm thử 3 Sale cùng block với backend mô phỏng giao dịch kéo dài 4 giây; cả FS05/06/07 chuyển được, không gửi chồng.
- SQLite cannot start a transaction within a transaction là lỗi phía backend; giãn thao tác giảm yêu cầu sát nhau, không sửa được transaction đã bị giữ mở trong mã server. Nếu vẫn lỗi sau giãn, cần kiểm tra commit/rollback phía FreeSWITCH.
- Reload extension và refresh dashboard/FreeSWITCH để áp dụng.

V1.9.15 — Sale hồi phục nhanh hơn
- Sale: cooldown 30 giây, 8 mẫu và ổn định liên tục 20 giây. Nếu VT ổn định ngay sau thao tác, có thể HEALTHY sau khoảng 50 giây.
- Giữ ngưỡng riêng Sale: tất cả VT > 0, median >= 4, range <= max(2, median * 35%), không tiếp tục tụt.
- Collection giữ cooldown 30 giây / 8 mẫu / ổn định 10 giây.
- Dùng cấu hình saleCooldownMs/saleRecoverySamples/saleRecoveryStableMs để bản cập nhật áp dụng cả khi storage vẫn lưu cấu hình chung 180 giây cũ.
- Không xóa khóa sự cố đang có; VT zero hoặc gián đoạn/mất ổn định vẫn chờ.
- Reload extension, refresh dashboard để áp dụng.

V1.9.14 — phân biệt từ chối trước thao tác và kết quả chưa rõ
- Content-script báo attempted=false khi không đúng một ACTIVE, số đã đổi hoặc select BLOCKED bị vô hiệu hóa trước change.
- Trường hợp này không giữ khóa COOLDOWN/RECOVERING: trở về SUSPECTED, kiểm tra lại sau 15 giây, tối đa 3 lần. Đây là kiểm tra lại trước thao tác, không gửi lại một change đã thực hiện.
- Nút Kiểm tra lại AUTO cho phép người dùng kiểm tra lại sau khi sửa trạng thái/trang.
- Timeout/mất kết nối hoặc kết quả không rõ sau gửi vẫn khóa để tránh thao tác trùng; không retry tự động.
- Nút Đã xử lý tay cho phép ghi nhận đã xử lý sau lỗi chưa rõ, xóa thông báo lỗi và giữ khóa chờ hồi phục.
- Select disabled không được báo là control sẵn sàng.
- Cần thông báo lỗi cụ thể của trang để chẩn đoán lỗi backend; bản này sửa khóa sai khi validation từ chối, không xác nhận đã sửa mọi lỗi FreeSWITCH.
- Reload extension, refresh FreeSWITCH và dashboard để cập nhật content-script.

V1.9.13 — Collection hồi phục nhanh để bắt lượt block tiếp theo
- Collection: cooldown 30 giây, 8 mẫu VT > 10, median >= 50, ổn định liên tục 10 giây rồi học baseline mới.
- Với traffic đã ổn định, có thể HEALTHY khoảng 40 giây sau thao tác. Traffic hồi phục muộn thì thời gian chờ dài hơn.
- Sale giữ cooldown 180 giây / 12 mẫu / 60 giây ổn định như trước.
- VT zero hoặc chỉ có spike ngắn không mở khóa. Chỉ tạo sự cố mới sau khi thực sự hồi phục.
- Kiểm thử hai số ACTIVE bị block lần lượt trong vòng 1–2 phút ở cả chế độ tay và tự động.
- Dashboard đếm cooldown theo đúng nhóm. Reload extension và refresh dashboard để áp dụng.

V1.9.12 — bỏ nút chế độ cũ
- Gỡ nút MONITOR và nhãn [MONITOR]/[CONFIRM] vì chỉ đổi nhãn, không điều khiển detection.
- MONITORING ON/OFF vẫn bật/tắt giám sát.
- Nút CONFIRM đổi tên Xác nhận BLOCK, chỉ hiện khi có yêu cầu đang chờ ở chế độ Xác nhận tay. Dùng mở lại popup sau Để sau.
- Chế độ BLOCK Xác nhận tay / Tự động giữ nguyên.
- Reload extension và refresh dashboard để cập nhật.

V1.9.11 — vuốt bảng, thông báo ngắn, hai chế độ BLOCK
- Bảng cập nhật các node hiện có, giữ scroll container và vị trí vuốt ngang; không dựng lại toàn bộ bảng mỗi giây.
- Thông báo test/kết quả thao tác trên dashboard tự ẩn sau 30 giây. Lịch sử sự kiện lưu vẫn giữ.
- Chế độ BLOCK: Xác nhận tay (mặc định) / Tự động, lưu qua restart.
- Chọn Tự động, bấm Bật tự động trong popup: khi AUTO BLOCK ON xử lý cả sự cố hợp lệ đang chờ, sau đó không hỏi từng lần.
- Chọn Xác nhận tay để trở về popup. AUTO BLOCK OFF vẫn không thao tác dù đã chọn Tự động.
- Test FS01 và cả hai chế độ dùng cùng thao tác select ACTIVE → BLOCKED đã test; không Đổi Số/BACKUP.
- Giữ lịch nghỉ theo nhóm, kiểm tra dữ liệu mới/đúng một số ACTIVE, và khóa một lần mỗi sự cố kể cả lỗi chưa rõ.
- Reload extension, refresh FreeSWITCH và dashboard để áp dụng.

V1.9.10 — phản hồi đổi trạng thái nhanh hơn
- Kiểm tra BLOCKED ngay sau change; nếu đã thấy thì trả kết quả ngay, không chờ timer 250ms/tab nền.
- Nếu chưa thấy vẫn kiểm tra 250ms và timeout 10 giây như cũ.
- GET_STATE chỉ ghi storage khi lịch thay đổi, giảm ghi lặp mỗi giây.
- Dashboard tạm ngừng polling trong lúc xác nhận hoặc test để tránh xếp thêm yêu cầu.
- Không tăng tốc backend FreeSWITCH; phản hồi vẫn dựa trên trạng thái DOM, không xác nhận backend độc lập.
- Reload extension và refresh FreeSWITCH/dashboard để áp dụng.

V1.9.9 — nút Test BLOCK FS01
- Nút trên dashboard lấy đúng số ACTIVE FS01 / COLLECTION và mở popup xác nhận test thật.
- Xác nhận dùng cùng content-script với AUTO: đổi select ACTIVE → BLOCKED và phát change. Không Đổi Số/BACKUP.
- Không cần AUTO ON, không cần SUSPECTED; test thủ công dùng được trong giờ nghỉ.
- Nếu dữ liệu VT hiện có >0 thì dừng test. Chỉ chấp nhận một ACTIVE FS01 và dữ liệu FreeSWITCH mới.
- Preview hết hạn 60 giây; kiểm tra lại số trước khi gửi. Đánh dấu đã gửi trước thao tác để chống xác nhận lặp.
- Kết quả theo DOM; refresh trang FreeSWITCH để kiểm tra đã lưu backend.
- Reload extension, refresh dashboard và FreeSWITCH để dùng nút mới.

V1.9.8 — TeleSale hồi phục với VT thấp
- RECOVERING của Sale: đủ 12 mẫu, tất cả VT > 0, median >= 4.
- Range <= max(2, median * 35%), không tiếp tục tụt; ổn định liên tục 60 giây rồi học baseline mới.
- Cooldown 180 giây vẫn giữ; VT = 0 hoặc có mẫu zero liên tục vẫn khóa, không AUTO lại.
- Collection giữ ngưỡng hồi phục cũ.
- Gián đoạn lấy mẫu >75 giây xóa bộ đếm ổn định; không tính thời gian thiếu dữ liệu vào hồi phục.
- Dashboard RECOVERING hiển thị điều kiện đang chờ hoặc số giây ổn định còn lại.
- Reload extension và refresh dashboard/FreeSWITCH để áp dụng; khóa hiện tại được giữ.

V1.9.7 — lịch nghỉ tách theo nhóm, thay thế lịch chung V1.9.6
- Sale 99.155 (FS05/06/07): nghỉ 11:30–13:00; 11:40 hệ thống ngoài tự chạy FS08/09/10, extension không tiếp quản nhóm Sale.
- Collection 99.153 (FS01/02/03/04): giám sát bình thường tới 12:10; nghỉ 12:10–13:00.
- Cả hai nhóm học lại baseline lúc 13:00 theo giờ Việt Nam, vẫn giữ khóa thao tác đã thực hiện.
- Nghỉ Sale không đóng cảnh báo/popup của Collection còn hợp lệ.
- Reload extension, refresh dashboard và FreeSWITCH sau cập nhật.

V1.9.6 — lịch nghỉ trưa hằng ngày (giờ Việt Nam UTC+7)
- 11:30 <= giờ < 13:00: dừng detection/BLOCK, đóng cảnh báo và popup chưa thực hiện, vẫn đọc VT.
- 11:30–11:40: giảm tải theo lịch, kể cả từ 500 xuống 90–100.
- 11:40–13:00: hệ thống ngoài tự chạy FS08/09/10; extension không chuyển FS hoặc đổi số trong khung này.
- 13:00: bỏ baseline trước giờ nghỉ, học lại 20 mẫu có VT > 10 (khoảng 40 giây theo polling 2 giây).
- Incident đã thao tác vẫn giữ khóa; không tự mở khóa vì hết giờ nghỉ.
- Kiểm tra lịch cả khi bấm xác nhận, khi GET_STATE và sau khi restart/offline.
- Giờ được tính cố định UTC+7, không phụ thuộc múi giờ máy.
- Xác nhận BLOCK sử dụng select và change của trang; DOM BLOCKED chưa phải xác nhận backend độc lập.
- Reload extension rồi refresh dashboard/FreeSWITCH để cập nhật.

V1.9.5 — nút xác nhận
- CONFIRM trên thanh công cụ mở popup xác nhận thật, hiển thị số yêu cầu đang chờ.
- Để sau hoặc Escape đóng popup để kiểm tra dashboard; không hủy sự cố. Bấm CONFIRM để mở lại.
- Hủy bỏ AUTO cho sự cố; Xác nhận mới gửi ACTIVE → BLOCKED.
- Nút hiển thị Đang xử lý khi gửi; lỗi/mất kết nối hiển thị trên dashboard và khôi phục nút.
- Reload extension và refresh dashboard/FreeSWITCH sau cập nhật.

V1.9.4 — refresh OpenSIPS
- Alarm 30 giây chỉ reload tab OpenSIPS không được chọn (active=false). Tab đang xem hoặc đang loading được bỏ qua.
- Đọc dữ liệu VT nền mỗi 2 giây vẫn tiếp tục; không reload trang đang xem.
- Reload extension để áp dụng.

V1.9.3 — xác nhận trước khi BLOCK (yêu cầu hiện tại)
- AUTO ON tạo popup trong dashboard: FS/profile, IP, số ACTIVE, VT, baseline, mức tụt.
- Bấm Xác nhận mới đổi ACTIVE → BLOCKED; Hủy bỏ qua AUTO cho sự cố này.
- Kiểm tra lại sự cố, dữ liệu, số đã xem và dòng ACTIVE trước thao tác. Không swap BACKUP.
- Popup nằm trong dashboard; dashboard đóng thì yêu cầu vẫn lưu và chờ khi mở lại.
- Reload extension, refresh tab FreeSWITCH và dashboard sau cập nhật.

V1.9.2 — AUTO BLOCK hiện tại (thay thế mô tả preview/swap bên dưới)
- AUTO ON + SUSPECTED: tìm đúng 1 số ACTIVE của FS/profile, đổi select sang BLOCKED và phát change theo cơ chế của trang.
- Không cần CONFIRM, không gọi markBlockedAndSwap, không yêu cầu/đổi BACKUP.
- Khóa sự cố trước thao tác; mỗi sự cố chỉ gửi 1 lần, kể cả khi kết quả chưa rõ.
- Kết quả quan sát là trạng thái DOM của trang, chưa phải xác nhận độc lập từ backend. Cần kiểm tra trên trang thật sau reload.
- Reload extension và refresh các tab nguồn/dashboard sau cập nhật.

AUTO CALL MONITOR V1

Purpose
- Read current traffic from Grafana panels 99.153 and 99.155.
- Read VT rows from OpenSIPS .153 (Collection) and .155 (TeleSale).
- Map SIP IP to FreeSWITCH FS node.
- Read ACTIVE phone number from FreeSWITCH.
- Detect sustained traffic + VT collapse and show SUSPECTED_BLOCK.
- V1 does NOT automatically change phone status. This is intentional for validation.

Install
1. Extract this folder.
2. Chrome -> chrome://extensions
3. Enable Developer mode.
4. Load unpacked -> select auto-call-monitor-v1.
5. Keep logged-in tabs open:
   - Grafana: http://10.10.101.126:3000/...
   - OpenSIPS: http://10.10.99.153/cp/main.php
   - OpenSIPS: http://10.10.99.155/cp/main.php
   - FreeSWITCH: http://10.10.101.67:5003/
6. On each OpenSIPS page, stay on the Load Balancer page.
7. Click the extension icon to inspect readings.

Current detection defaults
- Samples every 5 seconds.
- Global traffic trigger: below 60% of recent baseline.
- Node trigger: VT below 35% of recent baseline OR <= 30.
- Requires 3 consecutive bad VT samples.
- Only .153 Collection VT and .155 TeleSale VT are considered.

Important
OpenSIPS' "Refresh from Server" appears to be a server-side refresh operation. V1 only reads the DOM and does not submit that form automatically. If VT values do not update without pressing Refresh from Server, capture the Network request generated by that button (URL/method/form payload; redact cookies/auth) so V2 can refresh safely.

FreeSWITCH
The page exposes markBlockedAndSwap(phone, fs). V1 only reads the matching ACTIVE number and does not invoke it. After confirming detection is correct in real operation, V2 can add an explicit guarded CONFIRM/AUTO action with cooldown and audit logging.


V1.1 FIX
- Handles extension reload/update without stale-tab 'Extension context invalidated' spam.
- More flexible Grafana panel matching by 99.153/99.155 + NOW.
- IMPORTANT: after updating/reloading the extension, refresh all four monitored tabs once.

V1.2 FIX
- Fixed OpenSIPS row parsing for legacy nested Resources tables.
- Normalizes non-breaking spaces and whitespace.
- Uses table.rows + direct TD children to avoid nested resource-table cells corrupting column indexes.

V1.3: OpenSIPS parser now parses SIP IP + vt directly from each row's visible text and filters by known target IPs.

V1.4
- OpenSIPS server refresh approximately every 1 second using the page's own Refresh from Server form/session.
- Reads DOM every 250 ms.
- Keeps last 12 VT samples per node in memory and labels simple UP/DOWN/STABLE trend.
- Stores diagnostic info with each OpenSIPS sample.
- Does NOT change FreeSWITCH status automatically.

V1.5
- No longer depends on the Load Balancer screen being open.
- Every ~1 second POSTs directly to /cp/tools/system/loadbalancer/loadbalancer.php?action=add
  with refresh=Refresh from Server using the existing browser session.
- Parses the returned HTML and sends VT samples to the extension state.
- Does not navigate or reload the OpenSIPS UI.
- No automatic FreeSWITCH blocking yet.

V1.6
- Clicking the extension icon opens a persistent resizable dashboard window.
- The dashboard stays open until you close it; resize it by dragging its window edges.
- Manual MONITORING ON/OFF switch. OFF stops OpenSIPS polling and background sample processing.
- Event log records SUSPECTED / RECOVERED / MONITORING_ON / MONITORING_OFF.
- Displays per-FS VT trend.
- Event history capped at 200 entries; sample histories capped at 60 values to avoid unbounded storage growth.
- Still does NOT automatically block/change FreeSWITCH numbers.

V1.7 AUTO BLOCK
- Adds a separate AUTO BLOCK ON/OFF switch. Default is OFF.
- On a NEW confirmed SUSPECTED_BLOCK only, AUTO targets the exact FS and profile:
  99.153 => COLLECTION, 99.155 => TELESALE.
- FreeSWITCH must have exactly one open tab.
- It requires exactly one matching ACTIVE row for FS/profile and an existing
  "Khóa & Đổi Số" quick-action button. Otherwise it fails closed and logs AUTO_FAILED.
- On success it clicks the site's existing quick-action button, which invokes
  markBlockedAndSwap(phone, FS), then logs AUTO_BLOCKED.
- 3-minute per-FS/group cooldown prevents repeated actions.

V1.8 DETECTION FIX
- Fixes false SUSPECTED_BLOCK on FS nodes that were already VT=0 before the incident.
- A node is eligible only if it was an ACTIVE candidate before the drop:
  recent VT samples must be >10 and historical median must be >=50.
- IMPORTANT: current VT is allowed to fall below 10 or even to 0. That is a valid failure
  for a node that was previously active. The >10 rule is only for proving prior activity.
- Still requires Grafana global traffic drop + sustained per-node VT collapse for 3 samples.
- AUTO BLOCK uses only the corrected SUSPECTED list.

V1.9 UI
- Extension icon now opens dashboard.html as one resizable popup window.
- Re-clicking the icon focuses the existing dashboard window instead of opening duplicates.
- Fully responsive layout:
  desktop >= 900px: 99.153 and 99.155 side-by-side;
  narrower screens: cards stack vertically;
  very narrow widths: toolbar wraps and tables scroll horizontally.
- Dashboard can be moved and resized like a normal popup window.

Grafana
- The extension reads the currently rendered Grafana panel values.
- It does not automatically reload Grafana tabs.
- Keep the Grafana tab logged in and visible/active when accurate DOM-based readings
  are required.
- Grafana traffic is informational only. SUSPECTED_BLOCK detection uses OpenSIPS VT
  as the primary signal because it updates faster.

Detection state machine
- Each FS learns a median baseline from 8 samples while HEALTHY.
- The recent median uses 5 VT samples and transitions through WATCHING, WARNING,
  and SUSPECTED at 70%, 50%, and 35% of baseline.
- A confirmed Auto Block enters a per-FS 180-second COOLDOWN, then RECOVERING.
- Auto action is locked until recovery is stable for 12 samples and a new baseline
  is learned. One incident can be actioned at most once.
- If the current OpenSIPS VT is at or below the activity floor (10), the FS is
  treated as INACTIVE immediately. Older VT samples are not allowed to create a
  false SUSPECTED alert after an FS is stopped or replaced.

CURRENT DETECTION UPDATE (supersedes earlier detection notes)
- Dashboard opens in a normal Chrome tab. Reload the extension and all monitored
  pages after updating scripts. Existing locked incidents remain locked.
- Grafana and OpenSIPS collect every ~2 seconds, independently of MONITORING.
  Sampling requires the logged-in source tabs to remain open.
- Per-FS baseline: median of 20 healthy samples (~40s learning).
  Recent VT: median of 5 samples. Freeze baseline at WATCHING (<=70%).
- WARNING <=50%; SUSPECTED <=35%, with >=3 low samples in a window,
  >=3 sustained severe windows, and fresh Grafana recent median <=85%
  of the captured group baseline. Collapse must develop within 120s of WATCHING.
- VT can zig-zag or reach zero. An FS that never had traffic is not eligible.
- Slow decline stays in WATCHING/WARNING for manual review. Traffic alone cannot
  distinguish a carrier block from a sudden legitimate demand decrease.
- Preview requires one ACTIVE row for the matching FS/profile. Confirm revalidates
  incident, data freshness, toggles and target phone; at least one BACKUP is required.
- Lock is persisted before clicking markBlockedAndSwap. DOM must confirm old phone
  BLOCKED and one former BACKUP ACTIVE within 10s. Uncertain actions stay locked.
- Cooldown >=180s, then RECOVERING. Zero VT never clears a lock.
  Recovery requires 12 stable samples with real traffic, range <=35% of median,
  and median >=40% of old baseline to avoid treating tiny residual VT as recovered.
  This floor is conservative: manual investigation may be needed at very low demand.
- Clear history clears only visible events; it cannot reset incident locks.
- Thresholds are centralized in detection.js; stored config can override defaults.
  Tune using actual timestamps and traffic, not only a sequence of VT values.
- Run simulations: node --test tests/*.test.js

VT-ONLY UPDATE (supersedes Grafana confirmation above)
- Detection and Confirm use only fresh per-FS OpenSIPS VT. Grafana is displayed
  for reference only; missing/stale/unchanged Grafana never blocks detection.
- SUSPECTED still requires prior active traffic, frozen baseline, sustained severe
  VT windows and the collapse time limit. Preview/Confirm and incident locks remain.

OpenSIPS auto reload
- Each open OpenSIPS top-level tab reloads approximately every 30 seconds,
  including while MONITORING is OFF (collection continues). Chrome may delay
  timers for background tabs. Existing login session and stored incidents remain.
- POST Refresh from Server polling remains every 2 seconds; requests time out
  after 8 seconds so a hung request cannot stop polling indefinitely.
- config.opensipsReloadMs defaults to 30000; set to 60000 for one minute.

MANUAL WORKFLOW AND OFF-PEAK RECOVERY UPDATE
- Keep AUTO BLOCK OFF for manual operation. SUSPECTED identifies the FS; change
  its ACTIVE number to BLOCKED on FreeSWITCH yourself.
- Extension observes old ACTIVE becoming BLOCKED and a previously seen BACKUP
  becoming ACTIVE for the same FS/profile, then locks that incident automatically.
- If FreeSWITCH has not published this swap, use "Đã thay tay" on the SUSPECTED
  log entry after performing the change. This records your report and locks the
  incident; it never clicks or changes anything in FreeSWITCH.
- After 180s cooldown, recovery uses 12 stable VT samples and at least 60s of
  continuous stable windows. No percentage of old baseline is required: baseline
  500 -> stable 100, 150 or 200 can become the new healthy baseline.
- Median must be >=50 and all samples >10, with range <=35% of median. Tiny
  residual traffic remains locked. Under 50 calls requires manual review/tuning.
- OpenSIPS reload now uses chrome.alarms in the service worker at 30s intervals,
  instead of a page timer. Requires Chrome 120+. Alarms can still be delayed by
  Chrome or computer sleep; sample gaps >75s restart recent windows, keeping locks.
- Collection freshness threshold is now 45s to tolerate the background cadence.
  Foreground VT polling remains every 2s. Grafana is informational only.

V1.9.1 FIX — thay FS / tải thấp
- Khi ACTIVE đổi sang số khác, học lại baseline; không so số mới với tải của số cũ.
- Nhận thay tay khi số cũ BLOCKED và số mới ACTIVE cùng FS/profile, kể cả BACKUP mới bổ sung.
- Khi số chuyển sang FS khác hoặc về BACKUP, FS cũ xóa cảnh báo và học lại từ INACTIVE.
- Giảm chậm rồi ổn định với VT > 10 trong 60 giây: học baseline thấp mới. Không tự xóa SUSPECTED chỉ vì VT = 0.
- Nút Đã thay tay nằm ngay dòng FS, dùng được cả sau Clear history.
- Reload extension trong chrome://extensions, sau đó refresh các tab nguồn và dashboard.
- Kiểm thử: node --test tests/*.test.js
