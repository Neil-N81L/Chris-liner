-- Day-before messages at 17:00 Windhoek, driver lists and final trip details at 20:00 (times below are UTC).
select cron.unschedule('reconfirm-send');
select cron.schedule('reconfirm-send', '0 15 * * *', $$select public.run_bot_job('send')$$);
select cron.schedule('driver-manifests', '0 18 * * *', $$select public.run_bot_job('drivers')$$);
