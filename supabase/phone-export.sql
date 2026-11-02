-- Read-only inventory export uses existing authenticated commands and results.
begin;
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.call_monitor_mobile(text,text,jsonb)'::regprocedure);
 if position('PHONE_EXPORT' in definition)=0 then
  needle:='''PHONE_IMPORT_EXECUTE''';
  if position(needle in definition)=0 then raise exception 'Mobile whitelist changed; review export migration';end if;
  definition:=replace(definition,needle,'''PHONE_IMPORT_EXECUTE'',''PHONE_EXPORT''');
  execute definition;
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
