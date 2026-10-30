-- What new tabs start with, and the size of the code font. A null means the app's default.
alter table setting add column page_size integer check (page_size > 0);
alter table setting add column result_view text check (result_view in ('tree', 'table', 'json'));
alter table setting add column editor_font_size integer check (editor_font_size between 8 and 32);
