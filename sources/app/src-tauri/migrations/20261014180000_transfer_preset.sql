-- What the export and the import wizard were set to last (formats, options, the folder), so they
-- open that way again. One row per wizard; the value is the frontend's JSON, never credentials.
create table transfer_preset (
    wizard text primary key not null check (wizard in ('export', 'import')),
    value text not null check (json_valid(value))
);
