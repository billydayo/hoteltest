-- ============================================================
-- Roomilly 空房管理平台 - Supabase 資料庫結構
-- 在 Supabase Dashboard → SQL Editor 貼上整份執行即可（可重複執行）
--
-- 權限模型
--   訪客 (anon)          ：只能瀏覽房間，不能訂房
--   旅客會員 (authenticated)：登入取得 JWT 後，可透過 book_room() 訂房、
--                            並且只能取消「自己」訂的房
--   員工 (staff 名單內)   ：可直接新增 / 修改 / 刪除房間
-- ============================================================


-- ------------------------------------------------------------
-- 1. rooms 房間資料表
-- ------------------------------------------------------------
create table if not exists public.rooms (
    id            text primary key,
    name          text not null,
    type          text not null default 'Double',
    price         integer not null default 0,
    status        text not null default 'vacant',
    tags          text[] not null default '{}',
    occupant      text not null default '',
    checkin_date  date,
    checkout_date date,
    booked_by     uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now()
);

-- 舊資料表升級：補上「這筆訂房屬於哪位登入旅客」的欄位
alter table public.rooms
    add column if not exists booked_by uuid references auth.users(id) on delete set null;

alter table public.rooms
    add column if not exists created_at timestamptz not null default now();

-- 狀態 / 房型合法值
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
    check (status in ('vacant', 'booked', 'maintenance'));

alter table public.rooms drop constraint if exists rooms_type_check;
alter table public.rooms add constraint rooms_type_check
    check (type in ('Single', 'Double', 'Family'));

create index if not exists rooms_booked_by_idx on public.rooms (booked_by);


-- ------------------------------------------------------------
-- 2. staff 員工名單
--    只有列在這張表裡的使用者才是員工。
--    刻意「不」用 user_metadata 判斷身分 —— 那是使用者自己可以改的欄位，
--    任何註冊者都能把自己標成 staff，不可信任。
-- ------------------------------------------------------------
create table if not exists public.staff (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    email      text,
    created_at timestamptz not null default now()
);

alter table public.staff enable row level security;

-- 員工只能讀到自己那一列；沒有任何前端可寫入的政策（只能由 Dashboard/SQL 維護）
drop policy if exists "staff_select_self" on public.staff;
create policy "staff_select_self" on public.staff
    for select to authenticated
    using (user_id = auth.uid());


-- ------------------------------------------------------------
-- 3. is_staff() 判斷目前 JWT 的持有者是否為員工
-- ------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.staff s where s.user_id = auth.uid()
    );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;


-- ------------------------------------------------------------
-- 4. rooms 的 RLS 政策
--    讀：所有人（含未登入訪客）
--    寫：只有員工
-- ------------------------------------------------------------
alter table public.rooms enable row level security;

-- 先清掉舊版本留下的所有政策。開放旅客自助註冊後，任何「只要登入就能寫入」的
-- 舊政策都會變成漏洞（一般會員也能改房況），所以這裡整批移除後重建。
do $$
declare
    pol record;
begin
    for pol in
        select policyname from pg_policies
         where schemaname = 'public' and tablename = 'rooms'
    loop
        execute format('drop policy if exists %I on public.rooms', pol.policyname);
    end loop;
end;
$$;

drop policy if exists "rooms_select_public" on public.rooms;
create policy "rooms_select_public" on public.rooms
    for select to anon, authenticated
    using (true);

drop policy if exists "rooms_insert_staff" on public.rooms;
create policy "rooms_insert_staff" on public.rooms
    for insert to authenticated
    with check (public.is_staff());

drop policy if exists "rooms_update_staff" on public.rooms;
create policy "rooms_update_staff" on public.rooms
    for update to authenticated
    using (public.is_staff())
    with check (public.is_staff());

drop policy if exists "rooms_delete_staff" on public.rooms;
create policy "rooms_delete_staff" on public.rooms
    for delete to authenticated
    using (public.is_staff());


-- ------------------------------------------------------------
-- 5. book_room() 旅客訂房
--    ★ 必須登入（JWT 內要有 sub）才能呼叫，這是「要登入才能訂房」的
--      真正防線 —— 前端的按鈕鎖只是體驗，這裡才是強制力。
--    以 security definer 執行，但函式內部只允許
--    「把 vacant 的房間改成 booked」，旅客無法竄改房價等其他欄位。
-- ------------------------------------------------------------
-- 先移除舊版本（含任何參數型別不同的多載，避免 PostgREST 呼叫時無法判斷要用哪個）
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as sig
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('book_room', 'cancel_booking')
    loop
        execute 'drop function if exists ' || r.sig || ' cascade';
    end loop;
end;
$$;

create or replace function public.book_room(
    p_room_id    text,
    p_checkin    date,
    p_checkout   date,
    p_guest_name text default null
)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_room public.rooms;
begin
    if v_uid is null then
        raise exception '請先登入會員才能訂房' using errcode = '28000';
    end if;

    if p_checkin is null or p_checkout is null then
        raise exception '請選擇入住與退房日期' using errcode = '22007';
    end if;

    if p_checkout <= p_checkin then
        raise exception '退房日期必須晚於入住日期' using errcode = '22007';
    end if;

    update public.rooms
       set status        = 'booked',
           occupant      = coalesce(nullif(btrim(p_guest_name), ''), '旅客'),
           checkin_date  = p_checkin,
           checkout_date = p_checkout,
           booked_by     = v_uid
     where id = p_room_id
       and status = 'vacant'
    returning * into v_room;

    if not found then
        raise exception '此房間目前無法預訂（可能已被預訂或整理中）' using errcode = 'P0001';
    end if;

    return v_room;
end;
$$;

-- 未登入的 anon 角色完全不能呼叫；只有帶著有效 JWT 的 authenticated 才行
revoke all on function public.book_room(text, date, date, text) from public, anon;
grant execute on function public.book_room(text, date, date, text) to authenticated;


-- ------------------------------------------------------------
-- 6. cancel_booking() 取消訂房
--    只能取消自己訂的房；員工則可取消任何一筆。
-- ------------------------------------------------------------
create or replace function public.cancel_booking(p_room_id text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_room public.rooms;
begin
    if v_uid is null then
        raise exception '請先登入會員' using errcode = '28000';
    end if;

    update public.rooms
       set status        = 'vacant',
           occupant      = '',
           checkin_date  = null,
           checkout_date = null,
           booked_by     = null
     where id = p_room_id
       and status = 'booked'
       and (booked_by = v_uid or public.is_staff())
    returning * into v_room;

    if not found then
        raise exception '找不到可取消的預訂（您只能取消自己訂的房間）' using errcode = 'P0001';
    end if;

    return v_room;
end;
$$;

revoke all on function public.cancel_booking(text) from public, anon;
grant execute on function public.cancel_booking(text) to authenticated;


-- ------------------------------------------------------------
-- 7. 種子資料（房號重複時不覆蓋既有資料）
-- ------------------------------------------------------------
insert into public.rooms (id, name, type, price, status, tags) values
    ('101', '豪華單人雅緻房 101', 'Single', 1500, 'vacant', array['免費WiFi', '含早餐']),
    ('102', '豪華單人雅緻房 102', 'Single', 1500, 'vacant', array['免費WiFi', '含早餐']),
    ('105', '豪華雙人精緻房 105', 'Double', 2500, 'vacant', array['免費WiFi', '含早餐']),
    ('106', '豪華雙人精緻房 106', 'Double', 2500, 'vacant', array['免費WiFi', '含早餐']),
    ('109', '豪華家庭尊榮房 109', 'Family', 4000, 'vacant', array['大空間', '家庭專屬']),
    ('110', '豪華家庭尊榮房 110', 'Family', 4000, 'vacant', array['大空間', '家庭專屬'])
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- 8. 把某個帳號設為員工（先在 Authentication → Users 建立帳號，再執行）
--    把信箱換成實際的員工信箱後，取消註解執行：
-- ------------------------------------------------------------
-- insert into public.staff (user_id, email)
-- select id, email from auth.users where email = 'staff@example.com'
-- on conflict (user_id) do nothing;
