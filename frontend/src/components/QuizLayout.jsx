import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

// Secondary tab bar that sits under the global header on the Quiz route.
// Hosts the two separate quizzes as sibling sub-tabs. The global "Quiz" tab in
// GeneratorLayout stays active across both because it links to /quiz without
// `end`; here the "Vibe Check" link uses `end` so it only lights up on the
// index route, not on /quiz/saint-or-sinner.
function QuizLayout() {
  const tabClass = ({ isActive }) => 'quiz-subtab' + (isActive ? ' active' : '');

  return (
    <div className="quiz-subwrap">
      <nav className="quiz-subnav">
        <NavLink to="/quiz" end className={tabClass}>
          Vibe Check
        </NavLink>
        <NavLink to="/quiz/saint-or-sinner" className={tabClass}>
          Saint or Sinner
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

export default QuizLayout;
