from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv
import os
import requests

# Load environment variables
load_dotenv()

# Access .env variables
MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("DB_NAME", "userdb")  # default fallback
BASE_URL = os.getenv("BASE_URL", "http://localhost:9200")

# Setup MongoDB connection
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
users_collection = db['users']

# Create Flask Blueprint
auth_bp = Blueprint('auth', __name__)

# ----------------------- REGISTER -----------------------
@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    role = data.get('role')

    if not all([username, email, password, role]):
        return jsonify({'success': False, 'message': 'All fields are required'}), 400

    existing_user = users_collection.find_one({'email': email})
    if existing_user:
        return jsonify({'success': False, 'message': 'User already exists'}), 400

    hashed_password = generate_password_hash(password)
    user_data = {
        'username': username,
        'email': email,
        'password': hashed_password,
        'role': role
    }

    result = users_collection.insert_one(user_data)
    return jsonify({
        'success': True,
        'data': {
            'id': str(result.inserted_id),
            'username': username,
            'email': email,
            'role': role
        },
        'message': 'User registered successfully'
    }), 201

# ----------------------- LOGIN -----------------------
@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not all([email, password]):
        return jsonify({'success': False, 'message': 'Please provide an email and password'}), 400

    user = users_collection.find_one({'email': email})
    if not user or not check_password_hash(user['password'], password):
        return jsonify({'success': False, 'message': 'Invalid credentials'}), 401

    # Extract DB name from email prefix (before @)
    db_name = email.split('@')[0]

    # Call /set-db endpoint
    try:
        response = requests.post(f"{BASE_URL}/set-db", json={'db_name': db_name})
        if response.status_code != 200:
            return jsonify({'success': False, 'message': 'Login succeeded but failed to set DB'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error setting DB: {str(e)}'}), 500

    return jsonify({
        'success': True,
        'user': {
            'id': str(user['_id']),
            'email': user['email'],
            'username': user['username'],
            'role': user['role']
        },
        'db_name': db_name
    }), 200
