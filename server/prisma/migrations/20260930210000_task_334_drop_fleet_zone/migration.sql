-- TASK-334: the flat fleet Zone is gone (epic TASK-274). Zones are authored on
-- a digital twin (TwinZone); fleet zone rows carry no frame, so nothing migrates.
DROP TABLE IF EXISTS "Zone";
