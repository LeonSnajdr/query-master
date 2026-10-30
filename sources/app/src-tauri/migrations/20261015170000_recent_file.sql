-- Script files opened or saved in a shell, newest first in the menu; the app keeps the last few.
create table recent_file (
    path text primary key not null,
    used_at integer not null
);
