import React, { useState } from "react";

const NavBar = () => {
  const [menuVisible, setMenuVisible] = useState(false);

  const toggleMenu = () => setMenuVisible(true);
  const closeMenu = () => setMenuVisible(false);

  const linkAction = () => setMenuVisible(false);

  return (
    <div className="container nav__container">
      <header className="header" id="header">
        <nav>
          <div
            className={`nav__menu ${menuVisible ? "show__menu" : ""}`}
            id="nav-menu"
          >
            <ul className="nav__list">
              <li>
                <a
                  href="#home"
                  className="nav__link active__link"
                  onClick={linkAction}
                >
                  Home
                </a>
              </li>
              <li>
                <a
                  href="https://air-quality-checker-ftzu.onrender.com/"
                  className="nav__link"
                  onClick={linkAction}
                >
                  History
                </a>
              </li>
              <li>
                <a href="#popular" className="nav__link" onClick={linkAction}>
                  Features
                </a>
              </li>
              <li>
                <a href="#delivery" className="nav__link" onClick={linkAction}>
                  About
                </a>
              </li>
            </ul>

            <div className="nav__close" id="nav-close" onClick={closeMenu}>
              <i className="ri-close-large-line"></i>
            </div>
          </div>

          <div
            className={`nav__toggle ${menuVisible ? "hide-toggle" : ""}`}
            id="nav-toggle"
            onClick={toggleMenu}
          >
            <i className="ri-apps-2-fill"></i>
          </div>
        </nav>
      </header>
    </div>
  );
};

export default NavBar;
