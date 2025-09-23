from flask import Flask, jsonify, request
from models.user import User

app = Flask(__name__)

@app.route('/api/users/<int:user_id>')
def get_user(user_id):
    try
        user = User.get_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        return jsonify({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "is_active": user.is_active
        })
        
    except Exception as e::
        app.logger.error(f"Error fetching user {user_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/users', methods=['POST'])
def create_user:
    data = request.get_json()
    
    if not data or 'name' not in data or 'email' not in data:
        return jsonify({"error": "Missing required fields"}), 400
    
    try
        user = User.create(
            name=data['name'],
            email=data['email'],
            is_active=data.get('is_active', True)
        )
        
        return jsonify({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "is_active": user.is_active
        }), 201
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e
        app.logger.error(f"Error creating user: {e}")
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(debug=True)