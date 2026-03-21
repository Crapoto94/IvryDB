-- Initial Schema for PostGRE Admin Demo

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products Table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INTEGER DEFAULT 0,
    category VARCHAR(50)
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    order_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending'
);

-- Sample Data
INSERT INTO users (username, email, full_name) VALUES
('jdoe', 'john.doe@example.com', 'John Doe'),
('asmith', 'alice.smith@example.com', 'Alice Smith'),
('bwayne', 'bruce.wayne@example.com', 'Bruce Wayne')
ON CONFLICT DO NOTHING;

INSERT INTO products (name, description, price, stock_quantity, category) VALUES
('Premium Laptop', 'High-performance laptop for developers', 1299.99, 50, 'Electronics'),
('Wireless Mouse', 'Ergonomic wireless mouse', 29.99, 200, 'Accessories'),
('Mechanical Keyboard', 'RGB backlit mechanical keyboard', 89.99, 150, 'Accessories')
ON CONFLICT DO NOTHING;

INSERT INTO orders (user_id, total_amount, status) VALUES
(1, 1329.98, 'completed'),
(2, 29.99, 'shipped'),
(3, 89.99, 'pending')
ON CONFLICT DO NOTHING;
