-- =====================================================================
--  醫護教育創意設計大賞｜Healthcare Education Creative Awards
--  Supabase 資料庫結構、安全規則與後端投票程式（PostgreSQL）
--
--  使用方式：Supabase → SQL Editor → New query → 貼上本檔全部內容 → Run
--
--  ⚠️ 本檔可重複執行，但「每次執行都會清除全部投票資料並重建名單」。
--     正式投票開始後請勿再執行。
--
--  安全設計摘要
--  1. 所有資料表放在私有 schema「awards」，不對外開放（Data API 讀不到），
--     並全部啟用 Row Level Security 且不建立任何開放政策。
--  2. 前端只能呼叫 public schema 中以 aw_ 開頭的函式（SECURITY DEFINER），
--     由函式在伺服器端驗證身分、狀態與選票內容。
--  3. 投票代碼以高強度亂數產生，資料庫只保存 SHA-256 雜湊值。
--  4. 每張選票在單一交易中寫入；投票者資料列加鎖（FOR UPDATE），
--     並以 UNIQUE(round_no, voter_id) 約束保證每人每輪只有一張選票。
--  5. 投票提交對設定列加共享鎖，教師「結束投票」與提交互斥，
--     結束投票生效後伺服器拒絕所有新選票。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 0. 重建（清除舊資料）
-- ---------------------------------------------------------------------
drop schema if exists awards cascade;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'aw\_%'
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

create schema awards;
revoke all on schema awards from public;

-- ---------------------------------------------------------------------
-- 1. 資料表
-- ---------------------------------------------------------------------
create table awards.settings (
  id                    int primary key default 1 check (id = 1),
  event_name            text not null default '醫護教育創意設計大賞',
  status                text not null default 'setup'
                        check (status in ('setup','open','paused','closed')),
  allow_self            boolean not null default false,
  round_no              int not null default 1,
  started_at            timestamptz,
  paused_at             timestamptz,
  closed_at             timestamptz,
  published_pres        boolean not null default false,
  published_poster      boolean not null default false,
  placements_pres       jsonb,
  placements_poster     jsonb,
  placement_mode_pres   text,
  placement_mode_poster text,
  updated_at            timestamptz not null default now()
);

create table awards.groups (
  id           int primary key check (id between 1 and 99),
  label        text not null,
  title_pres   text not null default '',
  title_poster text not null default ''
);

create table awards.voters (
  id             uuid primary key default gen_random_uuid(),
  voter_key      text not null unique,          -- 投票者識別編號（學號或內部 ID，文字保存前導零）
  student_no     text,                          -- 學號（文字），學長姊可為空
  honorific      text,                          -- 學長／學姊
  name           text not null,
  group_id       int not null references awards.groups(id),
  sort_order     int not null default 0,
  eligible       boolean not null default true,
  code_hash      text unique,                   -- 投票代碼 SHA-256（不保存明碼）
  code_issued_at timestamptz,
  constraint voter_key_format check (voter_key ~ '^[0-9A-Za-z-]+$')
);

create table awards.ballots (
  id           bigint generated always as identity primary key,
  round_no     int not null,
  voter_id     uuid not null references awards.voters(id) on delete restrict,
  submitted_at timestamptz not null default clock_timestamp(),
  constraint one_ballot_per_voter_per_round unique (round_no, voter_id)
);

create table awards.picks (
  ballot_id bigint not null references awards.ballots(id) on delete cascade,
  category  text   not null check (category in ('pres','poster')),
  group_id  int    not null references awards.groups(id),
  primary key (ballot_id, category, group_id)   -- 同一類別不可重複選同一組
);
create index picks_cat_group on awards.picks(category, group_id);

create table awards.admins (
  user_id    uuid primary key,
  note       text,
  created_at timestamptz not null default now()
);

create table awards.failed_attempts (at timestamptz not null default now());

create table awards.audit_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  uuid,
  action text not null,
  detail jsonb
);

alter table awards.settings        enable row level security;
alter table awards.groups          enable row level security;
alter table awards.voters          enable row level security;
alter table awards.ballots         enable row level security;
alter table awards.picks           enable row level security;
alter table awards.admins          enable row level security;
alter table awards.failed_attempts enable row level security;
alter table awards.audit_log       enable row level security;
-- 不建立任何 policy：一般使用者無法直接讀寫任何資料表。

-- ---------------------------------------------------------------------
-- 2. 正式名單（12 組、28 位投票者）
--    學號以文字保存；學長姊沒有學號，使用不與學號衝突的內部 ID（SR-xx）
-- ---------------------------------------------------------------------
insert into awards.settings (id) values (1);

insert into awards.groups (id, label) values
  (1,'第 1 組'),(2,'第 2 組'),(3,'第 3 組'),(4,'第 4 組'),(5,'第 5 組'),(6,'第 6 組'),
  (7,'第 7 組'),(8,'第 8 組'),(9,'第 9 組'),(10,'第 10 組'),(11,'第 11 組'),(12,'第 12 組');

insert into awards.voters (voter_key, student_no, honorific, name, group_id, sort_order) values
  ('03','03',null,'李育昕',1,1),   ('12','12',null,'蔡承伶',1,2),
  ('26','26',null,'吳佳恩',2,1),   ('28','28',null,'王品潔',2,2),
  ('19','19',null,'施沛昕',3,1),   ('21','21',null,'吳嘉珍',3,2),
  ('17','17',null,'顏玟晴',4,1),   ('18','18',null,'陳亭嘉',4,2),
  ('13','13',null,'鄭亦傑',5,1),
  ('04','04',null,'簡紫羽',6,1),   ('06','06',null,'陳沛蓁',6,2),   ('20','20',null,'王思元',6,3),
  ('01','01',null,'葉芃孝',7,1),   ('10','10',null,'吳采霓',7,2),   ('14','14',null,'王芊雅',7,3),
  ('SR-01',null,'學姊','楊儀珈',8,1), ('27','27',null,'張家宥',8,2), ('29','29',null,'劉婷瑄',8,3),
  ('02','02',null,'潘星穎',9,1),   ('09','09',null,'楊宜芳',9,2),
  ('05','05',null,'戴筠瑩',10,1),  ('08','08',null,'薛喻心',10,2),  ('25','25',null,'陳思璇',10,3),
  ('15','15',null,'江芷嫺',11,1),  ('24','24',null,'蔡姍憓',11,2),  ('22','22',null,'張書翊',11,3),
  ('SR-02',null,'學長','黃富崙',12,1), ('SR-03',null,'學姊','林亭萱',12,2);

-- ---------------------------------------------------------------------
-- 3. 內部輔助函式（awards schema，外部無法呼叫）
-- ---------------------------------------------------------------------
create function awards.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from awards.admins a where a.user_id = auth.uid());
$$;

create function awards.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not awards.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
end $$;

create function awards.norm_code(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g'));
$$;

create function awards.hash_code(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(awards.norm_code(p), 'sha256'), 'hex');
$$;

-- 8 碼代碼，字元集排除易混淆的 0/O、1/I/L；以拒絕取樣避免偏差（31^8 ≈ 8.5 × 10^11 種組合）
create function awards.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  res text := '';
  b bytea;
  v int;
begin
  while length(res) < 8 loop
    b := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      v := get_byte(b, i);
      if v < 248 and length(res) < 8 then        -- 248 = 31 × 8
        res := res || substr(alphabet, (v % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  return substr(res,1,4) || '-' || substr(res,5,4);
end $$;

create function awards.members_json(p_group int) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', v.student_no, 'honorific', v.honorific, 'name', v.name)
           order by v.sort_order, v.voter_key), '[]'::jsonb)
  from awards.voters v where v.group_id = p_group;
$$;

create function awards.group_json(p_group int, p_cat text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id, 'label', g.label,
    'title', case when p_cat = 'pres' then g.title_pres else g.title_poster end,
    'members', awards.members_json(g.id))
  from awards.groups g where g.id = p_group;
$$;

-- 單一類別計票（只計目前輪次）；rnk 為標準競賽排名（同票同名次）
create function awards.tally(p_cat text)
returns table (group_id int, votes int, rnk int)
language sql stable set search_path = '' as $$
  with cur as (select s.round_no from awards.settings s where s.id = 1),
  c as (
    select p.group_id, count(*)::int as n
    from awards.picks p
    join awards.ballots b on b.id = p.ballot_id
    where p.category = p_cat and b.round_no = (select round_no from cur)
    group by p.group_id
  )
  select g.id, coalesce(c.n, 0),
         (rank() over (order by coalesce(c.n, 0) desc))::int
  from awards.groups g left join c on c.group_id = g.id;
$$;

-- 影響前三名的同票（只看得票 > 0 且名次 ≤ 3）
create function awards.ties(p_cat text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('rank', t.rnk, 'votes', t.votes, 'groups', t.ids)
                            order by t.rnk), '[]'::jsonb)
  from (
    select rnk, votes, array_agg(group_id order by group_id) as ids
    from awards.tally(p_cat)
    where votes > 0 and rnk <= 3
    group by rnk, votes
    having count(*) > 1
  ) t;
$$;

-- 依實際票數產生名次（同票並列），只有得票 > 0 的組別可得獎
create function awards.shared_placements(p_cat text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('place', t.rnk, 'group_id', t.group_id, 'votes', t.votes)
                            order by t.rnk, t.group_id), '[]'::jsonb)
  from awards.tally(p_cat) t
  where t.votes > 0 and t.rnk <= 3;
$$;

create function awards.log(p_action text, p_detail jsonb) returns void
language sql volatile set search_path = '' as $$
  insert into awards.audit_log(actor, action, detail) values (auth.uid(), p_action, p_detail);
$$;

-- ---------------------------------------------------------------------
-- 4. 公開函式（學生與投影畫面使用）
-- ---------------------------------------------------------------------

-- 活動狀態與 12 組卡片資料（不含任何票數）
create function public.aw_public_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'event_name', s.event_name,
    'status', s.status,
    'allow_self', s.allow_self,
    'round_no', s.round_no,
    'started_at', s.started_at,
    'published', jsonb_build_object('pres', s.published_pres, 'poster', s.published_poster),
    'eligible_count', (select count(*) from awards.voters v where v.eligible),
    'groups', (
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'label', g.label,
               'title_pres', g.title_pres, 'title_poster', g.title_poster,
               'members', awards.members_json(g.id)) order by g.id)
      from awards.groups g)
  )
  from awards.settings s where s.id = 1;
$$;

-- 驗證個人投票代碼
create function public.aw_verify_code(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s awards.settings;
  v awards.voters;
  voted timestamptz;
begin
  if (select count(*) from awards.failed_attempts f where f.at > now() - interval '1 minute') >= 120 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;
  select * into s from awards.settings where id = 1;
  select * into v from awards.voters where code_hash = awards.hash_code(p_code);
  if not found or length(awards.norm_code(p_code)) <> 8 then
    insert into awards.failed_attempts default values;
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;
  if not v.eligible then
    return jsonb_build_object('ok', false, 'error', 'NOT_ELIGIBLE');
  end if;
  select b.submitted_at into voted from awards.ballots b
   where b.voter_id = v.id and b.round_no = s.round_no;
  return jsonb_build_object(
    'ok', true,
    'name', v.name, 'honorific', v.honorific, 'student_no', v.student_no,
    'group_id', v.group_id,
    'group_label', (select g.label from awards.groups g where g.id = v.group_id),
    'has_voted', voted is not null, 'voted_at', voted,
    'status', s.status, 'allow_self', s.allow_self);
end $$;

-- 提交選票（單一原子交易）
create function public.aw_submit_ballot(p_code text, p_pres int[], p_poster int[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s awards.settings;
  v awards.voters;
  bid bigint;
  ts timestamptz;
  n_groups int;
begin
  if (select count(*) from awards.failed_attempts f where f.at > now() - interval '1 minute') >= 120 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  -- 共享鎖：與教師的開始／暫停／結束互斥，確保狀態判斷與寫入一致
  select * into s from awards.settings where id = 1 for share;

  select * into v from awards.voters where code_hash = awards.hash_code(p_code) for update;
  if not found or length(awards.norm_code(p_code)) <> 8 then
    insert into awards.failed_attempts default values;
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;
  if not v.eligible then
    return jsonb_build_object('ok', false, 'error', 'NOT_ELIGIBLE');
  end if;

  if s.status = 'setup'  then return jsonb_build_object('ok', false, 'error', 'VOTING_NOT_STARTED'); end if;
  if s.status = 'paused' then return jsonb_build_object('ok', false, 'error', 'VOTING_PAUSED');      end if;
  if s.status = 'closed' then return jsonb_build_object('ok', false, 'error', 'VOTING_CLOSED');      end if;

  if exists (select 1 from awards.ballots b where b.voter_id = v.id and b.round_no = s.round_no) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_VOTED');
  end if;

  -- 選票內容驗證：每類別恰好 3 個不同且存在的組別
  if p_pres is null or p_poster is null
     or cardinality(p_pres) <> 3 or cardinality(p_poster) <> 3
     or (select count(distinct x) from unnest(p_pres) x)   <> 3
     or (select count(distinct x) from unnest(p_poster) x) <> 3
     or array_position(p_pres, null) is not null
     or array_position(p_poster, null) is not null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SELECTION');
  end if;
  select count(*) into n_groups from awards.groups g
   where g.id = any(p_pres);
  if n_groups <> 3 then return jsonb_build_object('ok', false, 'error', 'INVALID_SELECTION'); end if;
  select count(*) into n_groups from awards.groups g
   where g.id = any(p_poster);
  if n_groups <> 3 then return jsonb_build_object('ok', false, 'error', 'INVALID_SELECTION'); end if;

  if not s.allow_self and (v.group_id = any(p_pres) or v.group_id = any(p_poster)) then
    return jsonb_build_object('ok', false, 'error', 'SELF_VOTE_NOT_ALLOWED');
  end if;

  begin
    insert into awards.ballots(round_no, voter_id) values (s.round_no, v.id)
      returning id, submitted_at into bid, ts;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_VOTED');
  end;

  insert into awards.picks(ballot_id, category, group_id)
    select bid, 'pres', x from unnest(p_pres) x
    union all
    select bid, 'poster', x from unnest(p_poster) x;

  return jsonb_build_object('ok', true, 'submitted_at', ts);
end $$;

-- 正式得獎結果（教師按下公布後才會回傳）
create function public.aw_public_results(p_cat text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s awards.settings;
  pub boolean;
  pl jsonb;
begin
  if p_cat not in ('pres','poster') then
    raise exception 'BAD_CATEGORY' using errcode = 'P0001';
  end if;
  select * into s from awards.settings where id = 1;
  pub := case when p_cat = 'pres' then s.published_pres else s.published_poster end;
  if not pub or s.status <> 'closed' then
    return jsonb_build_object('published', false, 'category', p_cat, 'event_name', s.event_name);
  end if;
  pl := case when p_cat = 'pres' then s.placements_pres else s.placements_poster end;
  return jsonb_build_object(
    'published', true,
    'category', p_cat,
    'event_name', s.event_name,
    'round_no', s.round_no,
    'mode', case when p_cat = 'pres' then s.placement_mode_pres else s.placement_mode_poster end,
    'total_votes', (select coalesce(sum(t.votes),0) from awards.tally(p_cat) t),
    'placements', (
      select coalesce(jsonb_agg(awards.group_json((e->>'group_id')::int, p_cat)
                                || jsonb_build_object('place', (e->>'place')::int, 'votes', (e->>'votes')::int)
                                order by (e->>'place')::int, (e->>'group_id')::int), '[]'::jsonb)
      from jsonb_array_elements(pl) e));
end $$;

-- ---------------------------------------------------------------------
-- 5. 教師管理函式（需登入且列於 awards.admins）
-- ---------------------------------------------------------------------
create function public.aw_admin_whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', auth.uid(), 'is_admin', awards.is_admin());
$$;

create function public.aw_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s awards.settings;
  n_eligible int; n_voted int; n_ballots int;
  cats jsonb := '{}'::jsonb;
  c text;
  tot int;
begin
  perform awards.require_admin();
  select * into s from awards.settings where id = 1;
  select count(*) into n_eligible from awards.voters v where v.eligible;
  select count(*) into n_ballots from awards.ballots b where b.round_no = s.round_no;
  select count(*) into n_voted from awards.ballots b join awards.voters v on v.id = b.voter_id
   where b.round_no = s.round_no and v.eligible;
  foreach c in array array['pres','poster'] loop
    select coalesce(sum(t.votes),0) into tot from awards.tally(c) t;
    cats := cats || jsonb_build_object(c, jsonb_build_object(
      'total_votes', tot,
      'ties', awards.ties(c),
      'placements', case when c = 'pres' then s.placements_pres else s.placements_poster end,
      'mode', case when c = 'pres' then s.placement_mode_pres else s.placement_mode_poster end,
      'published', case when c = 'pres' then s.published_pres else s.published_poster end,
      'rows', (
        select jsonb_agg(awards.group_json(t.group_id, c) || jsonb_build_object(
                 'votes', t.votes, 'rank', t.rnk,
                 'pct_votes',  case when tot > 0       then round(t.votes * 100.0 / tot, 1)       else 0 end,
                 'pct_voters', case when n_ballots > 0 then round(t.votes * 100.0 / n_ballots, 1) else 0 end)
               order by t.votes desc, t.group_id)
        from awards.tally(c) t)
    ));
  end loop;
  return jsonb_build_object(
    'settings', to_jsonb(s),
    'eligible', n_eligible, 'voted', n_voted, 'not_voted', n_eligible - n_voted,
    'ballots', n_ballots,
    'rate', case when n_eligible > 0 then round(n_voted * 100.0 / n_eligible, 1) else 0 end,
    'codes_missing', (select count(*) from awards.voters v where v.eligible and v.code_hash is null),
    'categories', cats,
    'server_time', now());
end $$;

create function public.aw_admin_roster() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform awards.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', v.id, 'voter_key', v.voter_key, 'student_no', v.student_no,
             'honorific', v.honorific, 'name', v.name,
             'group_id', v.group_id, 'group_label', g.label, 'sort_order', v.sort_order,
             'eligible', v.eligible, 'has_code', v.code_hash is not null,
             'code_issued_at', v.code_issued_at,
             'voted_at', b.submitted_at)
           order by v.group_id, v.sort_order, v.voter_key), '[]'::jsonb)
    from awards.voters v
    join awards.groups g on g.id = v.group_id
    cross join awards.settings s
    left join awards.ballots b on b.voter_id = v.id and b.round_no = s.round_no
    where s.id = 1);
end $$;

-- 開始／暫停／繼續／結束
create function public.aw_admin_set_status(p_action text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s awards.settings;
  missing int;
begin
  perform awards.require_admin();
  select * into s from awards.settings where id = 1 for update;   -- 排他鎖：等待進行中的提交完成
  if p_action = 'start' then
    if s.status <> 'setup' then raise exception 'BAD_TRANSITION' using errcode = 'P0001'; end if;
    select count(*) into missing from awards.voters v where v.eligible and v.code_hash is null;
    if missing > 0 then
      raise exception 'CODES_MISSING:%', missing using errcode = 'P0001';
    end if;
    update awards.settings set status = 'open', started_at = clock_timestamp(), paused_at = null, closed_at = null,
           updated_at = now() where id = 1;
  elsif p_action = 'pause' then
    if s.status <> 'open' then raise exception 'BAD_TRANSITION' using errcode = 'P0001'; end if;
    update awards.settings set status = 'paused', paused_at = clock_timestamp(), updated_at = now() where id = 1;
  elsif p_action = 'resume' then
    if s.status <> 'paused' then raise exception 'BAD_TRANSITION' using errcode = 'P0001'; end if;
    update awards.settings set status = 'open', paused_at = null, updated_at = now() where id = 1;
  elsif p_action = 'close' then
    if s.status not in ('open','paused') then raise exception 'BAD_TRANSITION' using errcode = 'P0001'; end if;
    update awards.settings set status = 'closed', closed_at = clock_timestamp(), updated_at = now(),   -- 取得排他鎖後的實際生效時間
      placements_pres       = case when jsonb_array_length(awards.ties('pres'))   = 0 then awards.shared_placements('pres')   end,
      placement_mode_pres   = case when jsonb_array_length(awards.ties('pres'))   = 0 then 'auto' end,
      placements_poster     = case when jsonb_array_length(awards.ties('poster')) = 0 then awards.shared_placements('poster') end,
      placement_mode_poster = case when jsonb_array_length(awards.ties('poster')) = 0 then 'auto' end
    where id = 1;
  else
    raise exception 'BAD_ACTION' using errcode = 'P0001';
  end if;
  perform awards.log('status:' || p_action, null);
  return public.aw_admin_overview();
end $$;

create function public.aw_admin_set_allow_self(p_allow boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform awards.require_admin();
  if (select status from awards.settings where id = 1 for update) <> 'setup' then
    raise exception 'LOCKED_AFTER_START' using errcode = 'P0001';
  end if;
  update awards.settings set allow_self = p_allow, updated_at = now() where id = 1;
  perform awards.log('allow_self', jsonb_build_object('value', p_allow));
  return jsonb_build_object('ok', true);
end $$;

create function public.aw_admin_set_event_name(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform awards.require_admin();
  if coalesce(trim(p_name),'') = '' then raise exception 'EMPTY_NAME' using errcode = 'P0001'; end if;
  update awards.settings set event_name = trim(p_name), updated_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- 作品名稱／組別名稱（不影響選票有效性，任何時候皆可修改）
create function public.aw_admin_update_group(p_id int, p_label text, p_title_pres text, p_title_poster text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform awards.require_admin();
  if coalesce(trim(p_label),'') = '' then raise exception 'EMPTY_NAME' using errcode = 'P0001'; end if;
  update awards.groups set label = trim(p_label),
         title_pres = coalesce(trim(p_title_pres),''),
         title_poster = coalesce(trim(p_title_poster),'')
   where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform awards.log('update_group', jsonb_build_object('id', p_id));
  return jsonb_build_object('ok', true);
end $$;

-- 新增／編輯投票者（僅限投票開始前）
create function public.aw_admin_upsert_voter(
  p_id uuid, p_student_no text, p_honorific text, p_name text,
  p_group_id int, p_eligible boolean, p_sort_order int default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  k text;
  n int;
  rid uuid;
begin
  perform awards.require_admin();
  if (select status from awards.settings where id = 1 for update) <> 'setup' then
    raise exception 'LOCKED_AFTER_START' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'EMPTY_NAME' using errcode = 'P0001'; end if;
  if not exists (select 1 from awards.groups where id = p_group_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  p_student_no := nullif(trim(p_student_no), '');
  p_honorific  := nullif(trim(p_honorific), '');
  if p_student_no is not null and p_student_no !~ '^[0-9A-Za-z]+$' then
    raise exception 'BAD_STUDENT_NO' using errcode = 'P0001';
  end if;

  if p_student_no is not null then
    k := p_student_no;
  elsif p_id is not null and (select v.student_no from awards.voters v where v.id = p_id) is null then
    k := (select v.voter_key from awards.voters v where v.id = p_id);
  else
    select coalesce(max(substr(voter_key, 4)::int), 0) + 1 into n
      from awards.voters where voter_key ~ '^SR-[0-9]+$';
    k := 'SR-' || lpad(n::text, 2, '0');
  end if;

  begin
    if p_id is null then
      insert into awards.voters(voter_key, student_no, honorific, name, group_id, eligible, sort_order)
      values (k, p_student_no, p_honorific, trim(p_name), p_group_id, coalesce(p_eligible, true),
              coalesce(p_sort_order, (select coalesce(max(sort_order),0)+1 from awards.voters where group_id = p_group_id)))
      returning id into rid;
    else
      update awards.voters set voter_key = k, student_no = p_student_no, honorific = p_honorific,
             name = trim(p_name), group_id = p_group_id, eligible = coalesce(p_eligible, eligible),
             sort_order = coalesce(p_sort_order, sort_order)
       where id = p_id returning id into rid;
      if rid is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_ID' using errcode = 'P0001';
  end;
  perform awards.log('upsert_voter', jsonb_build_object('id', rid, 'key', k));
  return jsonb_build_object('ok', true, 'id', rid, 'voter_key', k);
end $$;

-- 產生投票代碼（明碼只在此時回傳一次）
--   p_scope = 'missing'：只替尚未有代碼者產生（投票開始前）
--   p_scope = 'all'    ：全部重新產生，舊代碼立即失效（投票開始前）
--   p_scope = 'one'    ：補發單一位（遺失時使用；該員尚未投票且投票未結束）
create function public.aw_admin_generate_codes(p_scope text, p_voter uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s awards.settings;
  r record;
  code text;
  out_rows jsonb := '[]'::jsonb;
begin
  perform awards.require_admin();
  select * into s from awards.settings where id = 1 for update;
  if p_scope in ('missing','all') and s.status <> 'setup' then
    raise exception 'LOCKED_AFTER_START' using errcode = 'P0001';
  end if;
  if p_scope = 'one' then
    if s.status = 'closed' then raise exception 'VOTING_CLOSED' using errcode = 'P0001'; end if;
    if exists (select 1 from awards.ballots b where b.voter_id = p_voter and b.round_no = s.round_no) then
      raise exception 'ALREADY_VOTED' using errcode = 'P0001';
    end if;
  elsif p_scope not in ('missing','all') then
    raise exception 'BAD_ACTION' using errcode = 'P0001';
  end if;

  for r in
    select v.* from awards.voters v
    where v.eligible
      and (p_scope = 'all'
        or (p_scope = 'missing' and v.code_hash is null)
        or (p_scope = 'one' and v.id = p_voter))
    order by v.group_id, v.sort_order, v.voter_key
    for update
  loop
    loop
      code := awards.new_code();
      begin
        update awards.voters set code_hash = awards.hash_code(code), code_issued_at = now() where id = r.id;
        exit;
      exception when unique_violation then
        -- 極罕見的雜湊碰撞：重新產生
      end;
    end loop;
    out_rows := out_rows || jsonb_build_object(
      'voter_key', r.voter_key, 'student_no', r.student_no, 'honorific', r.honorific,
      'name', r.name, 'group_id', r.group_id,
      'group_label', (select g.label from awards.groups g where g.id = r.group_id),
      'code', code);
  end loop;
  if p_scope = 'one' and jsonb_array_length(out_rows) = 0 then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform awards.log('generate_codes', jsonb_build_object('scope', p_scope, 'count', jsonb_array_length(out_rows)));
  return jsonb_build_object('ok', true, 'codes', out_rows);
end $$;

-- 同票處理與名次確認（僅限投票結束後）
--   p_mode = 'shared'：同票並列名次
--   p_mode = 'manual'：加賽後由教師指定順序（只能在同票組別間調整，不可違反實際票數）
--   p_mode = 'auto'  ：無同票時依票數自動產生
create function public.aw_admin_set_placements(p_cat text, p_mode text, p_order int[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s awards.settings;
  pl jsonb;
  k int;
  top_votes int[];
  chosen_votes int[];
begin
  perform awards.require_admin();
  if p_cat not in ('pres','poster') then raise exception 'BAD_CATEGORY' using errcode = 'P0001'; end if;
  select * into s from awards.settings where id = 1 for update;
  if s.status <> 'closed' then raise exception 'NOT_CLOSED' using errcode = 'P0001'; end if;

  if p_mode = 'auto' then
    if jsonb_array_length(awards.ties(p_cat)) > 0 then
      raise exception 'TIE_NEEDS_DECISION' using errcode = 'P0001';
    end if;
    pl := awards.shared_placements(p_cat);
  elsif p_mode = 'shared' then
    pl := awards.shared_placements(p_cat);
  elsif p_mode = 'manual' then
    k := least(3, (select count(*) from awards.tally(p_cat) t where t.votes > 0))::int;
    if p_order is null or cardinality(p_order) <> k
       or (select count(distinct x) from unnest(p_order) x) <> k then
      raise exception 'BAD_ORDER' using errcode = 'P0001';
    end if;
    select array_agg(t.votes order by t.votes desc) into top_votes
      from (select votes from awards.tally(p_cat) where votes > 0 order by votes desc limit k) t;
    select array_agg(t.votes order by o.ord) into chosen_votes
      from unnest(p_order) with ordinality o(gid, ord)
      join awards.tally(p_cat) t on t.group_id = o.gid;
    -- 指定順序的票數必須與實際前 k 名票數完全一致（只允許同票者互換）
    if chosen_votes is distinct from top_votes then
      raise exception 'ORDER_CONFLICTS_WITH_VOTES' using errcode = 'P0001';
    end if;
    select jsonb_agg(jsonb_build_object('place', o.ord, 'group_id', o.gid, 'votes', t.votes) order by o.ord)
      into pl
      from unnest(p_order) with ordinality o(gid, ord)
      join awards.tally(p_cat) t on t.group_id = o.gid;
  else
    raise exception 'BAD_ACTION' using errcode = 'P0001';
  end if;

  if p_cat = 'pres' then
    update awards.settings set placements_pres = coalesce(pl,'[]'::jsonb), placement_mode_pres = p_mode,
           published_pres = false, updated_at = now() where id = 1;
  else
    update awards.settings set placements_poster = coalesce(pl,'[]'::jsonb), placement_mode_poster = p_mode,
           published_poster = false, updated_at = now() where id = 1;
  end if;
  perform awards.log('set_placements', jsonb_build_object('cat', p_cat, 'mode', p_mode, 'order', p_order));
  return jsonb_build_object('ok', true, 'placements', pl);
end $$;

-- 公布／收回得獎結果
create function public.aw_admin_publish(p_cat text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s awards.settings;
  pl jsonb;
begin
  perform awards.require_admin();
  if p_cat not in ('pres','poster') then raise exception 'BAD_CATEGORY' using errcode = 'P0001'; end if;
  select * into s from awards.settings where id = 1 for update;
  if p_on then
    if s.status <> 'closed' then raise exception 'NOT_CLOSED' using errcode = 'P0001'; end if;
    pl := case when p_cat = 'pres' then s.placements_pres else s.placements_poster end;
    if pl is null then raise exception 'TIE_NEEDS_DECISION' using errcode = 'P0001'; end if;
  end if;
  if p_cat = 'pres' then
    update awards.settings set published_pres = p_on, updated_at = now() where id = 1;
  else
    update awards.settings set published_poster = p_on, updated_at = now() where id = 1;
  end if;
  perform awards.log('publish', jsonb_build_object('cat', p_cat, 'on', p_on));
  return jsonb_build_object('ok', true);
end $$;

-- 建立新一輪投票（保留歷史選票作為紀錄，代碼沿用）
create function public.aw_admin_new_round() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s awards.settings;
begin
  perform awards.require_admin();
  select * into s from awards.settings where id = 1 for update;
  if s.status <> 'closed' then raise exception 'NOT_CLOSED' using errcode = 'P0001'; end if;
  update awards.settings set
    round_no = round_no + 1, status = 'setup',
    started_at = null, paused_at = null, closed_at = null,
    published_pres = false, published_poster = false,
    placements_pres = null, placements_poster = null,
    placement_mode_pres = null, placement_mode_poster = null,
    updated_at = now()
  where id = 1;
  perform awards.log('new_round', jsonb_build_object('round', s.round_no + 1));
  return jsonb_build_object('ok', true, 'round_no', s.round_no + 1);
end $$;

-- ---------------------------------------------------------------------
-- 6. 執行權限：先全部收回，再個別授權
--    （Supabase 預設會把 public 函式的執行權給 anon／authenticated）
-- ---------------------------------------------------------------------
revoke all on all functions in schema awards from public;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'aw\_%'
  loop
    execute 'revoke all on function ' || r.sig || ' from public, anon, authenticated';
  end loop;
end $$;

grant execute on function public.aw_public_state()                           to anon, authenticated;
grant execute on function public.aw_verify_code(text)                        to anon, authenticated;
grant execute on function public.aw_submit_ballot(text, int[], int[])        to anon, authenticated;
grant execute on function public.aw_public_results(text)                     to anon, authenticated;

grant execute on function public.aw_admin_whoami()                           to authenticated;
grant execute on function public.aw_admin_overview()                         to authenticated;
grant execute on function public.aw_admin_roster()                           to authenticated;
grant execute on function public.aw_admin_set_status(text)                   to authenticated;
grant execute on function public.aw_admin_set_allow_self(boolean)            to authenticated;
grant execute on function public.aw_admin_set_event_name(text)               to authenticated;
grant execute on function public.aw_admin_update_group(int, text, text, text) to authenticated;
grant execute on function public.aw_admin_upsert_voter(uuid, text, text, text, int, boolean, int) to authenticated;
grant execute on function public.aw_admin_generate_codes(text, uuid)         to authenticated;
grant execute on function public.aw_admin_set_placements(text, text, int[])  to authenticated;
grant execute on function public.aw_admin_publish(text, boolean)             to authenticated;
grant execute on function public.aw_admin_new_round()                        to authenticated;

-- 完成。下一步：在 Authentication 建立教師帳號，再執行 supabase/add_admin.sql。
