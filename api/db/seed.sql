-- EduSched demo data: one department, three batches, five professors, a full
-- Monday-Friday base timetable (generated clash-free; test/seed.test.ts re-checks it).
--
-- Demo logins (password for both: edusched-demo):
--   professor  prof.meera     (teaches CS201 and CS207 to CSE-2A and CSE-2B)
--   student    student.aarav  (batch CSE-2A)
-- Every other account has the unusable password '!locked' and cannot log in.
-- Hashes are PBKDF2-SHA256, 20k iterations (see src/password.ts).

INSERT INTO users (id, username, password, email, role, batch) VALUES
  (1, 'prof.meera', 'pbkdf2_sha256$20000$274DdWhxw6cXoEfqRWlbhQ==$DyasZKSxb/9tGMqvKU8YRDypuxROzeQm6Ba005QJk3w=', 'prof.meera@edusched.test', 'professor', NULL),
  (2, 'kabir.sethi', '!locked', 'kabir.sethi@edusched.test', 'professor', NULL),
  (3, 'nisha.rao', '!locked', 'nisha.rao@edusched.test', 'professor', NULL),
  (4, 'arjun.khanna', '!locked', 'arjun.khanna@edusched.test', 'professor', NULL),
  (5, 'farah.qureshi', '!locked', 'farah.qureshi@edusched.test', 'professor', NULL),
  (6, 'student.aarav', 'pbkdf2_sha256$20000$x+s1QNriUPEfPALmsYBqog==$uoyOzkRCN+OGoxCSJUmAZOub05vAkcdUI2drG4c3NhE=', 'student.aarav@edusched.test', 'student', 'CSE-2A'),
  (7, 'isha.verma', '!locked', 'isha.verma@edusched.test', 'student', 'CSE-2A'),
  (8, 'rohan.gupta', '!locked', 'rohan.gupta@edusched.test', 'student', 'CSE-2B'),
  (9, 'dev.malhotra', '!locked', 'dev.malhotra@edusched.test', 'student', 'CSE-2B'),
  (10, 'sana.sheikh', '!locked', 'sana.sheikh@edusched.test', 'student', 'ECE-2A');

INSERT INTO classrooms (id, room_number, capacity, building) VALUES
  (1, 'CR-201', 60, 'Main Block'),
  (2, 'CR-202', 60, 'Main Block'),
  (3, 'CR-203', 60, 'Main Block'),
  (4, 'LT-101', 120, 'Main Block'),
  (5, 'LAB-301', 40, 'Tech Block'),
  (6, 'LAB-302', 40, 'Tech Block');

INSERT INTO courses (id, course_code, course_name, professor_id) VALUES
  (1, 'CS201', 'Data Structures', 1),
  (2, 'CS207', 'Database Systems', 1),
  (3, 'CS203', 'Discrete Mathematics', 2),
  (4, 'MA201', 'Probability and Statistics', 2),
  (5, 'CS205', 'Computer Organization', 3),
  (6, 'EC205', 'Digital Electronics', 3),
  (7, 'EC201', 'Signals and Systems', 4),
  (8, 'EC203', 'Analog Circuits', 5),
  (9, 'HS201', 'Professional Communication', 5);

-- day_of_week: 1 = Monday ... 5 = Friday
INSERT INTO regular_timetable (id, course_id, batch, day_of_week, start_time, end_time, classroom_id) VALUES
  (1, 1, 'CSE-2A', 1, '09:00', '10:00', 1),  -- CSE-2A Mon CS201 CR-201
  (2, 2, 'CSE-2A', 1, '10:00', '11:00', 5),  -- CSE-2A Mon CS207 LAB-301
  (3, 5, 'CSE-2A', 1, '13:30', '14:30', 1),  -- CSE-2A Mon CS205 CR-201
  (4, 2, 'CSE-2A', 2, '10:00', '11:00', 1),  -- CSE-2A Tue CS207 CR-201
  (5, 3, 'CSE-2A', 2, '11:15', '12:15', 1),  -- CSE-2A Tue CS203 CR-201
  (6, 9, 'CSE-2A', 2, '14:30', '15:30', 1),  -- CSE-2A Tue HS201 CR-201
  (7, 1, 'CSE-2A', 3, '09:00', '10:00', 1),  -- CSE-2A Wed CS201 CR-201
  (8, 3, 'CSE-2A', 3, '11:15', '12:15', 1),  -- CSE-2A Wed CS203 CR-201
  (9, 5, 'CSE-2A', 3, '13:30', '14:30', 1),  -- CSE-2A Wed CS205 CR-201
  (10, 2, 'CSE-2A', 4, '10:00', '11:00', 1),  -- CSE-2A Thu CS207 CR-201
  (11, 5, 'CSE-2A', 4, '13:30', '14:30', 1),  -- CSE-2A Thu CS205 CR-201
  (12, 1, 'CSE-2A', 5, '09:00', '10:00', 1),  -- CSE-2A Fri CS201 CR-201
  (13, 3, 'CSE-2A', 5, '11:15', '12:15', 1),  -- CSE-2A Fri CS203 CR-201
  (14, 9, 'CSE-2A', 5, '14:30', '15:30', 1),  -- CSE-2A Fri HS201 CR-201
  (15, 9, 'CSE-2B', 1, '10:00', '11:00', 2),  -- CSE-2B Mon HS201 CR-202
  (16, 1, 'CSE-2B', 1, '11:15', '12:15', 2),  -- CSE-2B Mon CS201 CR-202
  (17, 3, 'CSE-2B', 1, '14:30', '15:30', 2),  -- CSE-2B Mon CS203 CR-202
  (18, 5, 'CSE-2B', 2, '09:00', '10:00', 2),  -- CSE-2B Tue CS205 CR-202
  (19, 1, 'CSE-2B', 2, '11:15', '12:15', 2),  -- CSE-2B Tue CS201 CR-202
  (20, 2, 'CSE-2B', 2, '13:30', '14:30', 5),  -- CSE-2B Tue CS207 LAB-301
  (21, 9, 'CSE-2B', 3, '10:00', '11:00', 2),  -- CSE-2B Wed HS201 CR-202
  (22, 2, 'CSE-2B', 3, '13:30', '14:30', 2),  -- CSE-2B Wed CS207 CR-202
  (23, 3, 'CSE-2B', 3, '14:30', '15:30', 2),  -- CSE-2B Wed CS203 CR-202
  (24, 5, 'CSE-2B', 4, '09:00', '10:00', 2),  -- CSE-2B Thu CS205 CR-202
  (25, 1, 'CSE-2B', 4, '11:15', '12:15', 2),  -- CSE-2B Thu CS201 CR-202
  (26, 3, 'CSE-2B', 4, '14:30', '15:30', 2),  -- CSE-2B Thu CS203 CR-202
  (27, 5, 'CSE-2B', 5, '09:00', '10:00', 2),  -- CSE-2B Fri CS205 CR-202
  (28, 2, 'CSE-2B', 5, '13:30', '14:30', 2),  -- CSE-2B Fri CS207 CR-202
  (29, 8, 'ECE-2A', 1, '09:00', '10:00', 3),  -- ECE-2A Mon EC203 CR-203
  (30, 4, 'ECE-2A', 1, '11:15', '12:15', 3),  -- ECE-2A Mon MA201 CR-203
  (31, 6, 'ECE-2A', 2, '10:00', '11:00', 3),  -- ECE-2A Tue EC205 CR-203
  (32, 9, 'ECE-2A', 2, '13:30', '14:30', 3),  -- ECE-2A Tue HS201 CR-203
  (33, 7, 'ECE-2A', 2, '14:30', '15:30', 3),  -- ECE-2A Tue EC201 CR-203
  (34, 8, 'ECE-2A', 3, '09:00', '10:00', 6),  -- ECE-2A Wed EC203 LAB-302
  (35, 4, 'ECE-2A', 3, '13:30', '14:30', 3),  -- ECE-2A Wed MA201 CR-203
  (36, 7, 'ECE-2A', 3, '14:30', '15:30', 3),  -- ECE-2A Wed EC201 CR-203
  (37, 8, 'ECE-2A', 4, '09:00', '10:00', 3),  -- ECE-2A Thu EC203 CR-203
  (38, 6, 'ECE-2A', 4, '10:00', '11:00', 3),  -- ECE-2A Thu EC205 CR-203
  (39, 9, 'ECE-2A', 4, '13:30', '14:30', 3),  -- ECE-2A Thu HS201 CR-203
  (40, 6, 'ECE-2A', 5, '10:00', '11:00', 3),  -- ECE-2A Fri EC205 CR-203
  (41, 4, 'ECE-2A', 5, '13:30', '14:30', 3),  -- ECE-2A Fri MA201 CR-203
  (42, 7, 'ECE-2A', 5, '14:30', '15:30', 3);  -- ECE-2A Fri EC201 CR-203

-- Explicit ids above; move the identity sequences past them.
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('classrooms', 'id'), (SELECT max(id) FROM classrooms));
SELECT setval(pg_get_serial_sequence('courses', 'id'), (SELECT max(id) FROM courses));
SELECT setval(pg_get_serial_sequence('regular_timetable', 'id'), (SELECT max(id) FROM regular_timetable));
