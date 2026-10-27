begin;
create schema if not exists call_monitor_private;
revoke all on schema call_monitor_private from public, anon, authenticated;
create table if not exists call_monitor_private.credentials (id boolean primary key default true check(id), token_hash text not null);
create table if not exists call_monitor_private.history (id text primary key, at bigint not null, event jsonb not null);
create index if not exists call_monitor_history_at on call_monitor_private.history(at desc, id);
alter table call_monitor_private.history enable row level security;
alter table call_monitor_private.credentials enable row level security;
revoke all on all tables in schema call_monitor_private from public, anon, authenticated;
-- Tác dụng: Xác thực token để ghi/đọc/xóa lịch sử, khử trùng sự kiện và phân trang kết quả.
create or replace function public.call_monitor_history(p_token text,p_action text,p_events jsonb default '[]',p_start bigint default null,p_end bigint default null,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e jsonb; result jsonb; affected integer;
begin
 if p_token is null or not exists(select 1 from call_monitor_private.credentials where token_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex')) then
  raise exception 'History access denied' using errcode='42501';
 end if;
 if p_action='append' then
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 then raise exception 'Invalid history batch';end if;
  for e in select value from jsonb_array_elements(p_events) loop
   if not (e->>'type'=any(array['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED','FS_TRANSFERRED','FS_ENABLED','FS_DISABLED'])) or e->>'id' is null or e->>'fs' is null or e->>'incidentId' is null or e->>'at' is null then raise exception 'Invalid history event';end if;
   insert into call_monitor_private.history(id,at,event) values(e->>'id',(e->>'at')::bigint,e-'synced') on conflict(id) do update set at=excluded.at,event=excluded.event;
  end loop;
  return jsonb_build_object('saved',jsonb_array_length(p_events));
 elsif p_action='read' then
  if p_offset<0 then raise exception 'Invalid offset';end if;
  select coalesce(jsonb_agg(x.event),'[]'::jsonb) into result from (select event from call_monitor_private.history where (p_start is null or at>=p_start) and (p_end is null or at<p_end) order by at desc,id limit 500 offset p_offset)x;
  return result;
 elsif p_action='delete' then
  if p_start is null or p_end is null or p_start>=p_end then raise exception 'Invalid delete range';end if;
  delete from call_monitor_private.history where at>=p_start and at<p_end;get diagnostics affected=row_count;
  return jsonb_build_object('deleted',affected);
 else raise exception 'Invalid history action';end if;
end $$;
revoke all on function public.call_monitor_history(text,text,jsonb,bigint,bigint,integer) from public, anon, authenticated;
grant execute on function public.call_monitor_history(text,text,jsonb,bigint,bigint,integer) to anon, authenticated;
notify pgrst,'reload schema';
commit;
