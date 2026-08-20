-- =============================================================================
-- 0007  create_user_food(...)  — atomic user-food creation
-- -----------------------------------------------------------------------------
-- Creates a private food + its per-100g nutrition (+ optional barcode) in one
-- transaction, so a failed nutrition insert can never leave an orphan food.
--
-- SECURITY INVOKER (the default): the function runs AS THE CALLER, so every
-- insert is still subject to RLS. It cannot be used to write official foods or
-- another user's data — the same WITH CHECK policies from 0005 apply. The
-- backend has already validated the nutrition (bounds + calorie cross-check,
-- §4.11) before calling this.
-- =============================================================================

create or replace function create_user_food(
  p_name             text,
  p_brand            text,
  p_default_serving_g numeric,
  p_calories         numeric,
  p_protein          numeric,
  p_fat              numeric,
  p_carbs            numeric,
  p_fiber            numeric,
  p_sugar            numeric,
  p_sodium           numeric,
  p_barcode          text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_food_id uuid;
begin
  insert into foods (owner_user_id, is_official, name, brand, source, default_serving_g)
  values (auth.uid(), false, p_name, p_brand, 'user_manual', p_default_serving_g)
  returning id into v_food_id;

  insert into food_nutrition
    (food_id, calories_kcal, protein_g, fat_g, carbs_g, fiber_g, sugar_g, sodium_mg)
  values
    (v_food_id, p_calories, p_protein, p_fat, p_carbs, p_fiber, p_sugar, p_sodium);

  if p_barcode is not null then
    insert into food_barcodes (food_id, barcode) values (v_food_id, p_barcode);
  end if;

  return v_food_id;
end;
$$;

revoke all on function create_user_food(text, text, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text) from public;
grant execute on function create_user_food(text, text, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text) to authenticated;
