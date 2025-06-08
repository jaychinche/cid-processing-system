// src/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:9200',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
