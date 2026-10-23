-- Databases the tree shows besides those the server lists, for users who may not list them all
-- (the original's "Visible databases"); names separated by commas, empty for none.
alter table connection add column visible_databases text not null default '';
