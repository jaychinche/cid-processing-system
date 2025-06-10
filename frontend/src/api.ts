// src/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://cid-2.onrender.com',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
