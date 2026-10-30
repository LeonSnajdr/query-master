-- What a connection is used for; it decides how the app asks before writing. null: not said.
alter table connection add column environment text
    check (environment in ('development', 'test', 'production'));
