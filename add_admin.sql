-- =====================================================================
--  設定教師管理員
--  1. 先到 Supabase → Authentication → Users → Add user → Create new user
--     輸入教師 Email 與密碼（勾選 Auto Confirm User）。
--  2. 把下面的 Email 換成剛剛建立的教師 Email，然後執行本檔。
-- =====================================================================
insert into awards.admins (user_id, note)
select id, email from auth.users where email = 'teacher@example.com'
on conflict (user_id) do nothing;

-- 確認：應該看到一筆教師資料
select a.user_id, u.email from awards.admins a join auth.users u on u.id = a.user_id;
