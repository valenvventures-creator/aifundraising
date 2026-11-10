-- The application must connect as a NON-superuser: superusers bypass row-level security.
CREATE ROLE ainp LOGIN PASSWORD 'ainp' NOSUPERUSER NOCREATEROLE;
CREATE DATABASE ainp OWNER ainp;
