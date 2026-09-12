-- 记录每个「会话 + 器件组 + 板面」已经确认取用过的位号，避免同一位号被重复扣库存。
ALTER TABLE welding_progress ADD COLUMN confirmed_designators TEXT NOT NULL DEFAULT '[]';

-- 历史行没有位号级审计时，新的重复校验会形同虚设，因此从取用流水回补。
-- 被 reverse 流水撤销过的取用不计入。
UPDATE welding_progress
   SET confirmed_designators = COALESCE((
       SELECT json_group_array(token.value)
         FROM (
             SELECT id, session_id, component_key, side, confirmation_designators
               FROM inventory_movements
              WHERE movement_type = 'consume'
                AND json_valid(confirmation_designators)
         ) AS taken
         CROSS JOIN json_each(taken.confirmation_designators) AS token
        WHERE taken.session_id = welding_progress.session_id
          AND taken.component_key = welding_progress.component_key
          AND taken.side = welding_progress.side
          AND NOT EXISTS (
              SELECT 1
                FROM inventory_movements AS reversal
               WHERE reversal.reverses_movement_id = taken.id
          )
   ), '[]')
 WHERE EXISTS (
     SELECT 1
       FROM inventory_movements AS scoped
      WHERE scoped.session_id = welding_progress.session_id
        AND scoped.component_key = welding_progress.component_key
        AND scoped.side = welding_progress.side
        AND scoped.movement_type = 'consume'
 );
