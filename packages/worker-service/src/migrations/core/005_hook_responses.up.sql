-- Record what was sent back to the agent from each hook feature
ALTER TABLE _hook_activity ADD COLUMN output_snapshot TEXT;
