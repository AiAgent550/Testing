-- Seed rows for scripts/smoke-jobs.mjs: the jobs smoke test must not depend on the customers,
-- vehicles or bookings endpoints, so it brings its own records. Ids and regs are unique to this file.
INSERT INTO customers (id, name, phone, email, source, created_at, updated_at) VALUES
  ('cus_jobseed0000000000001', 'Jobs Seed Customer', '+447700900111', 'jobs-seed@example.com', 'phone', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
  ('cus_jobseed0000000000002', 'Jobs Seed Second', '+447700900222', NULL, 'walk_in', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');

INSERT INTO vehicles (id, reg, vin, make, model, colour, fuel_type, year, engine_cc, last_mileage, customer_id, created_at, updated_at) VALUES
  ('veh_jobseed0000000000001', 'MK26JOB', NULL, 'MERCEDES-BENZ', 'C 220 D', 'Silver', 'DIESEL', 2015, 2143, 97000, 'cus_jobseed0000000000001', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
  ('veh_jobseed0000000000002', 'MK26JBB', NULL, 'FORD', 'RANGER', 'Blue', 'DIESEL', 2019, 1996, 60000, 'cus_jobseed0000000000002', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');

INSERT INTO bookings (id, ref, customer_id, vehicle_id, service, description, preferred_date, location, status, source, created_at, updated_at) VALUES
  ('bkg_jobseed0000000000001', 'MK-J9001', 'cus_jobseed0000000000001', 'veh_jobseed0000000000001', 'keys', 'All keys lost. Steering lock clicks but the car will not start.', '2026-10-22', 'workshop', 'confirmed', 'phone', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
  ('bkg_jobseed0000000000002', 'MK-J9002', 'cus_jobseed0000000000002', 'veh_jobseed0000000000002', 'remap', 'Stage 1 remap for towing.', '2026-10-23', 'workshop', 'requested', 'website', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
  ('bkg_jobseed0000000000003', 'MK-J9003', 'cus_jobseed0000000000002', 'veh_jobseed0000000000002', 'diagnostics', 'Cancelled booking.', '2026-10-24', 'workshop', 'cancelled', 'phone', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');
