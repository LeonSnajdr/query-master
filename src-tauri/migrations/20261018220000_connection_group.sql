-- The group a saved connection is listed in (the original's connection groups); empty for none.
alter table connection add column group_name text not null default '';
