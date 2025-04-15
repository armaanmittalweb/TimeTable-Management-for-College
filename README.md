# Timetable Management App

## Overview
A comprehensive timetable management application designed for educational institutions, allowing students and professors to view, manage, and interact with class schedules dynamically.

## Features

### User Authentication
- Two user types: Students and Professors
- Secure registration and login system
- Role-based access control

### Timetable Management
#### Student Features
- View personal class schedule
- Receive real-time updates about class changes
- Track class cancellations and postponements

#### Professor Features
- View personal class schedule
- Cancel classes
- Postpone classes with advanced rescheduling options
- Select alternative time slots
- Choose available classrooms for rescheduled classes

### Unique Functionalities
- Temporary weekly modifications
- Classroom availability tracking
- Automatic reversion to original schedule after one week

## Technology Stack

### Frontend
- React (Vite)
- React Router for navigation
- State Management Library (Redux/Context API)
- Axios for API requests
- Tailwind CSS for styling

### Backend
- Node.js with Express.js
- Authentication middleware
- RESTful API design

### Database
- MySQL
- Sequelize ORM for database interactions

### Additional Technologies
- JWT for secure authentication
- Bcrypt for password hashing
- Moment.js for date and time manipulation

## Prerequisites
- Node.js (v16 or higher)
- npm or Yarn
- MySQL Server

## Installation and Setup

### Clone the Repository
```bash
git clone https://github.com/armaanmittalweb/timetable-management-app.git
cd timetable-management-app
```

### Backend Setup
1. Navigate to backend directory
```bash
cd backend
npm install
```

2. Create `.env` file with the following configurations:
```
DB_HOST=localhost
DB_USER=your_mysql_username
DB_PASSWORD=your_mysql_password
DB_NAME=timetable_db
JWT_SECRET=your_jwt_secret
```

3. Setup Database
```bash
npm run db:migrate
npm run db:seed
```

4. Start Backend Server
```bash
npm start
```

### Frontend Setup
1. Navigate to frontend directory
```bash
cd ../frontend
npm install
```

2. Create `.env` file with backend API endpoint
```
VITE_API_ENDPOINT=http://localhost:5000/api
```

3. Start Development Server
```bash
npm run dev
```

## API Endpoints
- `/auth/register` - User Registration
- `/auth/login` - User Authentication
- `/timetable` - Fetch Timetable
- `/classes/cancel` - Cancel Class
- `/classes/postpone` - Postpone Class

## Security Considerations
- JWT-based authentication
- Password hashing
- Role-based access control
- Input validation
- CORS protection

## Contribution Guidelines
1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Push to the branch
5. Create a Pull Request

## Future Roadmap
- Mobile responsiveness
- Email/SMS notifications
- Advanced analytics
- Integration with learning management systems

## License
MIT License

## Contact
Your Name - armaanmittal00@gmail.com
