// Updated AuthPage.tsx to match backend requirements and remove unnecessary features
import React, { useState } from 'react';
import axios from 'axios';
import { Eye, EyeOff, Mail, Lock, User, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

interface FormData {
  email: string;
  password: string;
  confirmPassword?: string;
  fullName?: string;
  role?: string;
}

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  fullName?: string;
}

const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    role: 'user'
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();


  const validateEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    if (!formData.email) newErrors.email = 'Email is required';
    else if (!validateEmail(formData.email)) newErrors.email = 'Invalid email';
    if (!formData.password) newErrors.password = 'Password is required';
    else if (formData.password.length < 8) newErrors.password = 'Minimum 8 characters';
    if (!isLogin) {
      if (!formData.fullName) newErrors.fullName = 'Full name required';
      if (!formData.confirmPassword) newErrors.confirmPassword = 'Confirm password';
      else if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!validateForm()) return;
  setIsLoading(true);

  try {
    if (isLogin) {
       const res = await api.post('/api/auth/login',  {
        email: formData.email,
        password: formData.password
      });
      setMessage('Login successful');
      console.log(res.data);

      // ✅ Redirect to /dashboard
      navigate('/dashboard');
    } else {
        const res = await api.post('/api/auth/register', {
        username: formData.fullName,
        email: formData.email,
        password: formData.password,
        role: formData.role
      });
      navigate('/login');
      setMessage('Registration successfull');
      navigate('/login');
      console.log(res.data);
    }
  } catch (err: any) {
    setMessage(err.response?.data?.message || 'Something went wrong');
  } finally {
    setIsLoading(false);
  }
};

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-3xl shadow-2xl border border-white/20 p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-white text-center mb-4">{isLogin ? 'Login' : 'Register'}</h1>

        {message && <p className="text-center text-white bg-blue-500 rounded p-2 mb-4">{message}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <User className="text-white mb-1" />
              <input
                type="text"
                placeholder="Full Name"
                value={formData.fullName}
                onChange={e => handleInputChange('fullName', e.target.value)}
                className="w-full p-3 rounded bg-white/10 text-white border border-white/20"
              />
              {errors.fullName && <p className="text-red-400 text-sm">{errors.fullName}</p>}
            </div>
          )}

          <div>
            <Mail className="text-white mb-1" />
            <input
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={e => handleInputChange('email', e.target.value)}
              className="w-full p-3 rounded bg-white/10 text-white border border-white/20"
            />
            {errors.email && <p className="text-red-400 text-sm">{errors.email}</p>}
          </div>

          <div className="relative">
            <Lock className="text-white mb-1" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={formData.password}
              onChange={e => handleInputChange('password', e.target.value)}
              className="w-full p-3 rounded bg-white/10 text-white border border-white/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white"
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
            {errors.password && <p className="text-red-400 text-sm">{errors.password}</p>}
          </div>

          {!isLogin && (
            <div className="relative">
              <Lock className="text-white mb-1" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm Password"
                value={formData.confirmPassword}
                onChange={e => handleInputChange('confirmPassword', e.target.value)}
                className="w-full p-3 rounded bg-white/10 text-white border border-white/20"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white"
              >
                {showConfirmPassword ? <EyeOff /> : <Eye />}
              </button>
              {errors.confirmPassword && <p className="text-red-400 text-sm">{errors.confirmPassword}</p>}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200"
          >
            {isLoading ? 'Loading...' : isLogin ? 'Login' : 'Register'}
          </button>
        </form>

        <p className="text-center text-slate-300 mt-4">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setErrors({});
              setFormData({ email: '', password: '', confirmPassword: '', fullName: '', role: 'user' });
              setMessage(null);
            }}
            className="text-blue-400 hover:underline"
          >
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthPage;