import { createContext, useState } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [isLoggedIn, setIsLoggedInState] = useState(
        () => localStorage.getItem('isLoggedIn') === 'true'
    );

    const setIsLoggedIn = (val) => {
        localStorage.setItem('isLoggedIn', String(val));
        setIsLoggedInState(val);
    };

    return (
        <AuthContext.Provider value={{ isLoggedIn, setIsLoggedIn }}>
            {children}
        </AuthContext.Provider>
    );
}
