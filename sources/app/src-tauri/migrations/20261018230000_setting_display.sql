-- How results are shown and opened, as the original's preferences; null: the default.
alter table setting add column default_tab text check (default_tab in ('browse', 'shell', 'aggregate', 'sql'));
alter table setting add column time_zone text check (time_zone in ('local', 'utc'));
alter table setting add column date_format text check (date_format in ('local', 'iso', 'dmy', 'mdy'));
alter table setting add column legacy_uuid text check (legacy_uuid in ('raw', 'dotnet', 'java', 'python'));
alter table setting add column auto_expand text check (auto_expand in ('none', 'first', 'all'));
alter table setting add column json_view text check (json_view in ('shell', 'relaxed', 'canonical'));
alter table setting add column number_grouping integer check (number_grouping in (0, 1));
alter table setting add column type_colors integer check (type_colors in (0, 1));
alter table setting add column tab_width integer check (tab_width in (2, 4, 8));
alter table setting add column auto_close integer check (auto_close in (0, 1));
