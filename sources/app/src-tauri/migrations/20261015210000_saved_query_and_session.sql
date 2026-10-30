-- Queries the user named. scope_collection is null for queries of a whole database (shell, SQL).
create table saved_query
(
    id               integer not null primary key autoincrement,
    connection_id    blob    not null references connection (id) on delete cascade,
    database_name    text    not null,
    scope_collection text,
    kind             text    not null check (kind in ('browse', 'aggregate', 'shell', 'sql')),
    name             text    not null check (length(trim(name)) > 0),
    folder           text,
    content          text    not null check (json_valid(content)),
    date_created     text    not null,
    date_used        text
) strict;

create index idx_saved_query_scope on saved_query (connection_id, database_name, scope_collection);

-- The tabs of the last session, in their order; replaced as a whole on each save.
create table session_tab
(
    position      integer not null primary key,
    active        integer not null check (active in (0, 1)),
    connection_id blob    references connection (id) on delete cascade,
    content       text    not null check (json_valid(content))
) strict;

-- What the app does at the start with the tabs of the last session: ask, restore them, or start empty.
alter table setting add column startup text check (startup in ('ask', 'restore', 'empty'));
