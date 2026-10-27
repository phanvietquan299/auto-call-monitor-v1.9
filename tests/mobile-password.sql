begin;
DO $test$
declare token text=gen_random_uuid()::text; pass text=gen_random_uuid()::text; auth jsonb; result jsonb; saved_session text;
begin
 insert into call_monitor_private.mobile_access(code_hash,code_expires,session_hash,session_expires) values(encode(sha256(convert_to(token||'code','UTF8')),'hex'),0,encode(sha256(convert_to(token,'UTF8')),'hex'),(extract(epoch from clock_timestamp())*1000)::bigint+60000);
 result=public.call_monitor_mobile(token,'set_password',jsonb_build_object('password',pass));
 if result->>'ok'<>'true' then raise exception 'Password setup failed';end if;
 auth=public.call_monitor_mobile('','password_login',jsonb_build_object('password',pass));
 if auth->>'ok'<>'true' or (auth->>'expires')::bigint<(extract(epoch from clock_timestamp())*1000)::bigint+2591900000 then raise exception 'Login/session expiry failed';end if;
 saved_session=auth->>'session';result=public.call_monitor_mobile(saved_session,'state');
 result=public.call_monitor_mobile(saved_session,'set_password',jsonb_build_object('password',pass||'new'));
 result=public.call_monitor_mobile(saved_session,'state');
 if exists(select 1 from call_monitor_private.mobile_access where session_hash=encode(sha256(convert_to(token,'UTF8')),'hex')) then raise exception 'Old session not revoked';end if;
 for i in 1..5 loop result=public.call_monitor_mobile('','password_login',jsonb_build_object('password','wrong-password'));if result->>'ok'<>'false' then raise exception 'Wrong password accepted';end if;end loop;
 result=public.call_monitor_mobile('','password_login',jsonb_build_object('password',pass||'new'));
 if result->>'ok'<>'false' then raise exception 'Rate limit failed';end if;
 if exists(select 1 from call_monitor_private.mobile_password where password_hash=pass or password_hash=pass||'new') then raise exception 'Plaintext password saved';end if;
end $test$;
rollback;
