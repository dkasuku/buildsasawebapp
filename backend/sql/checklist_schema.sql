-- ============================================================================
-- Buildflex — Checklist schema (PostgreSQL)
-- ----------------------------------------------------------------------------
-- Predefined, strongly-typed columns so imports/uploads can't compromise data
-- integrity. Categories use the CONSTRUCTION trades the app already uses
-- (see src/app/components/constructai/roles.ts -> TRADES), not generic industries.
-- ============================================================================

-- Required once per database:
--   create extension if not exists "uuid-ossp";

-- ---- Construction work categories (mirrors the app's TRADES list) -----------
create type construction_category as enum (
    'none',
    'general',
    'electrical',
    'plumbing',
    'painting',
    'carpentry',
    'hvac',
    'masonry',
    'roofing',
    'drywall',
    'concrete',
    'landscaping',
    'earthwork',
    'asphalt_paving',
    'grading',
    'drainage',
    'bridge',
    'traffic_control'
);

-- ---- Answer / question types accepted by the app ----------------------------
-- (mirrors AnswerType: text, number, percentage, photo, yes_no, checkbox)
create type checklist_question_type as enum (
    'text',
    'number',
    'percentage',
    'photo',
    'yes_no',
    'checkbox'
);

-- ---- Groups (folders) of checklists, optionally nested -----------------------
create table if not exists checklist_groups (
    id                bigserial primary key,
    name              varchar(100) not null,
    description       text not null,
    no_of_checklists  integer not null default 0,
    parent_group_id   bigint references checklist_groups(id) on delete set null,
    company_id        uuid not null references companies(id) on delete cascade,
    created_at        timestamp default current_timestamp
);

create index if not exists idx_checklist_groups_parent_group_id
    on checklist_groups(parent_group_id);

-- ---- Checklists --------------------------------------------------------------
create table if not exists checklists (
    id                  uuid primary key default uuid_generate_v4(),
    name                text not null,
    description         text not null,
    category            construction_category not null default 'none',
    company_id          uuid not null references companies(id) on delete cascade,
    checklist_group_id  bigint references checklist_groups(id) on delete cascade,
    public              boolean not null default false,
    uploaded_by         uuid not null references users(id) on delete cascade,
    created_at          timestamp default current_timestamp
);

create index if not exists idx_checklists_company_id on checklists(company_id);
create index if not exists idx_checklists_group_id   on checklists(checklist_group_id);

-- ---- Checklist items (the questions) ----------------------------------------
-- Column names are FIXED here and in the Excel upload template so an import maps
-- 1:1 to the table and bad/extra columns are rejected rather than silently kept.
create table if not exists checklist_items (
    id                       bigserial primary key,
    checklist_id             uuid not null references checklists(id) on delete cascade,
    order_index              int not null,
    question_group           text not null,
    checklist_item_caption   text,
    question_type            checklist_question_type not null,
    default_answer           text default null,
    photo_available          text not null check (photo_available in ('Yes', 'No')) default 'No',
    answer_options           text[] not null default '{}',
    corrective_option        text,
    corrective_actions       text[] not null default '{}',
    policy                   text
);

create index if not exists idx_checklist_items_checklist_id
    on checklist_items(checklist_id);

-- Keep item order unique & stable within a checklist (extra integrity guard).
create unique index if not exists uq_checklist_items_order
    on checklist_items(checklist_id, order_index);
