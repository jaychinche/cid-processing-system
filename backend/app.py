from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pymongo import MongoClient
from datetime import datetime, date
import openpyxl
import tempfile
import pandas as pd
import os
import json
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
import requests
import threading
import signal
import sys
from concurrent.futures import ThreadPoolExecutor
from auth_routes import auth_bp
from dotenv import load_dotenv
import certifi 

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "https://cid-processing-system.vercel.app"}}, supports_credentials=True)

# === Global State ===
should_pause = False
should_stop = False
active_workers = 0
processing_active = False
worker_threads = []
current_collection_name = None

# === Database Setup ===
MONGO_URI = os.getenv('MONGO_URI')
DB_NAME = os.getenv('DB_NAME')

# Initialize MongoDB connection
try:
    client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
    db = client[DB_NAME] if DB_NAME else client['default_db']
    print(f"✅ Connected to MongoDB database: {db.name}")
except Exception as e:
    print(f"❌ MongoDB connection failed: {e}")
    db = None

# === Scraping Configuration ===
URL = "https://www.apeasternpower.com/viewBillDetailsMain"
CHECK_INTERVAL = 5
CHECK_INTERNET_URL = "http://www.google.com"
MAX_RETRIES = 3
RETRY_DELAY = 10
BATCH_SIZE = 10

def get_chrome_options():
    """Get Chrome options optimized for server deployment"""
    options = webdriver.ChromeOptions()
    
    # Essential headless options for server
    options.add_argument('--headless=new')  # Use new headless mode
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--disable-extensions')
    options.add_argument('--disable-plugins')
    options.add_argument('--disable-images')  # Don't load images for faster scraping
    options.add_argument('--disable-javascript')  # Only if the site works without JS
    
    # Memory and performance optimizations
    options.add_argument('--memory-pressure-off')
    options.add_argument('--max_old_space_size=4096')
    options.add_argument('--disable-background-timer-throttling')
    options.add_argument('--disable-renderer-backgrounding')
    options.add_argument('--disable-backgrounding-occluded-windows')
    
    # Network and security
    options.add_argument('--disable-web-security')
    options.add_argument('--disable-features=VizDisplayCompositor')
    options.add_argument('--disable-ipc-flooding-protection')
    
    # Window size for consistent rendering
    options.add_argument('--window-size=1920,1080')
    
    # User agent to avoid bot detection
    options.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    # Additional server-specific options
    options.add_argument('--remote-debugging-port=9222')
    options.add_argument('--disable-background-networking')
    options.add_argument('--disable-sync')
    options.add_argument('--disable-translate')
    options.add_argument('--disable-default-apps')
    
    return options

def create_webdriver():
    """Create a webdriver instance with proper error handling"""
    try:
        options = get_chrome_options()
        
        # Try to create driver with ChromeDriverManager first
        try:
            service = ChromeService(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
        except Exception as e:
            print(f"⚠️ ChromeDriverManager failed: {e}")
            # Fallback to system chrome
            driver = webdriver.Chrome(options=options)
        
        # Set timeouts
        driver.set_page_load_timeout(30)
        driver.implicitly_wait(10)
        
        return driver
        
    except Exception as e:
        print(f"❌ Failed to create webdriver: {e}")
        raise

def get_collection(collection_name):
    """Get a MongoDB collection by name"""
    if not db:
        raise Exception("Database not connected")
    return db[collection_name]

app.register_blueprint(auth_bp, url_prefix='/api/auth')

@app.route('/send-dbname', methods=['POST'])
def get_user_db():
    """Get the user database collection"""
    return get_userdb('user_db')

@app.route('/set-db', methods=['POST'])
def set_db():
    global DB_NAME, db, client

    data = request.get_json()
    db_name = data.get('db_name')

    if not db_name:
        return jsonify({'error': 'Database name is required'}), 400

    try:
        MONGO_URI = os.getenv('MONGO_URI')
        client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
        db = client[db_name]
        DB_NAME = db_name
        print(f"✅ Database set to: {DB_NAME}")
        return jsonify({'message': f'Database set to {DB_NAME}'}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to connect to database: {str(e)}'}), 500

def signal_handler(sig, frame):
    global should_stop
    print("\n🛑 Received interrupt signal. Stopping gracefully...")
    should_stop = True
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

def convert_date_fields(doc):
    """Convert date fields to datetime for MongoDB storage"""
    if 'date_added' in doc and isinstance(doc['date_added'], date):
        doc['date_added'] = datetime.combine(doc['date_added'], datetime.min.time())
    if 'processed_date' in doc and isinstance(doc['processed_date'], date):
        doc['processed_date'] = datetime.combine(doc['processed_date'], datetime.min.time())
    return doc

def check_internet_connection():
    """Check if internet connection is available"""
    try:
        response = requests.get(CHECK_INTERNET_URL, timeout=10, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
        return response.status_code == 200
    except requests.RequestException as e:
        print(f"❌ Internet check failed: {e}")
        return False

def wait_for_internet():
    """Wait until internet connection is restored"""
    print("🌐 Waiting for internet connection...")
    while not check_internet_connection() and not should_stop:
        time.sleep(5)
    print("🌐 Internet connection restored")

def check_pause():
    """Check if pause was requested"""
    global should_pause
    if should_pause:
        print("⏸ Scraping paused. Send resume request to continue")
        while should_pause and not should_stop:
            time.sleep(1)
        if should_stop:
            print("🛑 Stopping as requested during pause")
            return True
        print("▶ Resuming scraping...")
    return False

def clean_amount(amount_text):
    """Clean and convert amount text to float"""
    if not amount_text:
        return None
    
    cleaned = ''.join(c for c in amount_text if c.isdigit() or c == '.')
    
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None

def process_cid(driver, cid):
    """Process a single CID using Selenium with improved error handling"""
    retries = 0
    while retries < MAX_RETRIES and not should_stop:
        try:
            if not check_internet_connection():
                wait_for_internet()
                if should_stop:
                    return None
            
            print(f"🔍 Processing CID {cid} (attempt {retries + 1})")
            
            # Navigate to the page
            driver.get(URL)
            time.sleep(3)  # Increased wait time

            # Enter CID with better error handling
            try:
                cid_field = WebDriverWait(driver, 15).until(
                    EC.element_to_be_clickable((By.ID, 'ltscno'))
                )
                cid_field.clear()
                cid_field.send_keys(str(cid))
            except TimeoutException:
                raise Exception("CID input field not found or not clickable")

            # Handle CAPTCHA
            try:
                captcha_element = WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.ID, 'Billquestion'))
                )
                captcha_text = driver.execute_script("return arguments[0].innerText;", captcha_element).strip()
                
                if not captcha_text:
                    raise Exception("CAPTCHA text is empty")
                
                answer_field = driver.find_element(By.ID, 'Billans')
                answer_field.clear()
                answer_field.send_keys(captcha_text)
                
                submit_btn = driver.find_element(By.ID, 'Billsignin')
                driver.execute_script("arguments[0].click();", submit_btn)
                time.sleep(3)
                
            except Exception as e:
                raise Exception(f"CAPTCHA handling failed: {str(e)}")

            # Check for alerts/errors
            try:
                WebDriverWait(driver, 2).until(EC.alert_is_present())
                alert = driver.switch_to.alert
                alert_text = alert.text
                alert.accept()
                raise Exception(f"Alert appeared: {alert_text}")
            except TimeoutException:
                pass  # No alert is good

            # Click History button
            try:
                WebDriverWait(driver, 15).until(
                    EC.element_to_be_clickable((By.ID, "historyDivbtn"))
                )
                driver.execute_script("window.scrollBy(0, 300);")
                time.sleep(2)
                
                history_btn = driver.find_element(By.ID, "historyDivbtn")
                driver.execute_script("arguments[0].click();", history_btn)
                time.sleep(3)
                
            except TimeoutException:
                raise Exception("History button not found - possible CAPTCHA failure")

            # Scrape consumption data
            try:
                data_table = WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.ID, "consumptionData"))
                )
                rows = data_table.find_elements(By.TAG_NAME, "tr")[1:]  # Skip header
                
                if not rows:
                    raise Exception("No data rows found in consumption table")

                monthly_amounts = {}
                amounts = []
                
                for row in rows:
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) < 4:
                        continue
                    
                    bill_month = cells[1].text.strip().upper()
                    
                    # Try to get amount from input field first, then cell text
                    try:
                        amount_element = cells[3].find_element(By.TAG_NAME, "input")
                        amount_text = amount_element.get_attribute("value").strip()
                    except NoSuchElementException:
                        amount_text = cells[3].text.strip()
                    
                    amount = clean_amount(amount_text)
                    
                    # Map bill months to field names
                    if 'APR' in bill_month or 'APRIL' in bill_month:
                        monthly_amounts['April25'] = amount
                    elif 'MAY' in bill_month:
                        monthly_amounts['May25'] = amount
                    elif 'JUN' in bill_month or 'JUNE' in bill_month:
                        monthly_amounts['June25'] = amount
                    
                    if amount is not None:
                        amounts.append(amount)

                # Calculate highest amount
                if amounts:
                    monthly_amounts['Highest'] = max(amounts)

                return monthly_amounts

            except TimeoutException:
                raise Exception("Consumption data table not found")

        except Exception as e:
            retries += 1
            error_msg = str(e)[:150]
            print(f"⚠️ Attempt {retries}/{MAX_RETRIES} failed for CID {cid}: {error_msg}")
            
            if retries < MAX_RETRIES and not should_stop:
                print(f"🔄 Retrying CID {cid} in {RETRY_DELAY} seconds...")
                time.sleep(RETRY_DELAY)
                
                # Try to refresh the page for next attempt
                try:
                    driver.refresh()
                    time.sleep(3)
                except:
                    pass
            else:
                print(f"❌ All attempts failed for CID {cid}")
                raise e
    
    return None

def worker_thread(worker_id, collection_name):
    """Worker function with improved driver management"""
    global should_pause, should_stop, active_workers
    
    driver = None
    try:
        print(f"👷 Worker {worker_id} starting for collection {collection_name}")
        
        # Create webdriver for this worker
        driver = create_webdriver()
        print(f"✅ Worker {worker_id} webdriver created successfully")
        
        collection = get_collection(collection_name)
        
        while not should_stop:
            if check_pause():
                should_stop = True
                break
                
            try:
                # Fetch batch of CIDs to process
                docs_to_process = list(collection.find(
                    {'status': 'new'}, 
                    limit=BATCH_SIZE
                ))
                
                if not docs_to_process:
                    print(f"ℹ️ Worker {worker_id}: No more CIDs to process")
                    break
                
                # Update status atomically
                doc_ids = [doc['_id'] for doc in docs_to_process]
                update_result = collection.update_many(
                    {'_id': {'$in': doc_ids}, 'status': 'new'},
                    {'$set': {'status': 'processing'}}
                )
                
                if update_result.modified_count == 0:
                    continue
                
                batch = list(collection.find({'_id': {'$in': doc_ids}, 'status': 'processing'}))
                print(f"👷 Worker {worker_id} processing {len(batch)} CIDs")
                
                processed_count = 0
                failed_count = 0
                
                for doc in batch:
                    if should_stop:
                        break
                        
                    cid = doc['cid']
                    
                    try:
                        monthly_data = process_cid(driver, cid)
                        if monthly_data is not None:
                            update_data = {
                                'status': 'processed',
                                'processed_date': datetime.now(),
                                **monthly_data
                            }
                            
                            collection.update_one(
                                {'_id': doc['_id']},
                                {'$set': update_data}
                            )
                            processed_count += 1
                            print(f"✅ Worker {worker_id} processed CID {cid}")
                        else:
                            raise Exception("No data returned from scraping")
                            
                    except Exception as e:
                        collection.update_one(
                            {'_id': doc['_id']},
                            {'$set': {
                                'status': 'failed',
                                'error': str(e)[:500],
                                'processed_date': datetime.now()
                            }}
                        )
                        failed_count += 1
                        print(f"❌ Worker {worker_id} failed CID {cid}: {str(e)[:100]}")
                
                print(f"📊 Worker {worker_id} batch complete: {processed_count} success, {failed_count} failed")
                time.sleep(2)  # Brief pause between batches
                
            except Exception as e:
                print(f"❌ Worker {worker_id} batch error: {str(e)}")
                time.sleep(5)
        
        print(f"🏁 Worker {worker_id} finished")
        
    except Exception as e:
        print(f"❌ Worker {worker_id} critical error: {str(e)}")
    finally:
        active_workers -= 1
        if driver:
            try:
                driver.quit()
                print(f"🚪 Worker {worker_id} driver closed")
            except:
                pass

# Rest of your Flask routes remain the same...

# Add health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for server monitoring"""
    try:
        # Test database connection
        db.command('ping')
        db_status = "connected"
    except:
        db_status = "disconnected"
    
    # Test internet connection
    internet_status = "connected" if check_internet_connection() else "disconnected"
    
    return jsonify({
        'status': 'healthy',
        'database': db_status,
        'internet': internet_status,
        'processing_active': processing_active,
        'active_workers': active_workers
    })

# Your other routes (pause, resume, stop, status, download, collections) remain the same...

@app.route('/upload', methods=['POST'])
def upload_excel():
    file = request.files.get('file')
    tag = request.form.get('tag', 'default')
    collection_name = request.form.get('collection', 'default_collection')
    
    if not file:
        return jsonify({'error': 'No file uploaded'}), 400
    
    try:
        # Get or create the specified collection
        collection = get_collection(collection_name)
        
        # Read Excel file
        wb = openpyxl.load_workbook(file)
        ws = wb.active
        cids = []

        for row in ws.iter_rows(min_row=2, values_only=True):
            cid = row[0]
            if cid:
                doc = {
                    'cid': str(cid).strip(),
                    'status': 'new',
                    'April25': None,
                    'May25': None,
                    'June25': None,
                    'Highest': None,
                    'date_added': datetime.now(),
                    'tag': tag,
                    'collection': collection_name
                }
                cids.append(doc)

        if cids:
            # Get existing CIDs to avoid duplicates
            existing_cids = set(doc['cid'] for doc in collection.find(
                {'tag': tag, 'collection': collection_name}, 
                {'cid': 1}
            ))
            
            # Filter out duplicates
            new_docs = [doc for doc in cids if doc['cid'] not in existing_cids]
            
            if new_docs:
                collection.insert_many(new_docs)
                return jsonify({
                    'inserted': len(new_docs), 
                    'skipped': len(cids) - len(new_docs),
                    'tag': tag,
                    'collection': collection_name
                })
            else:
                return jsonify({
                    'inserted': 0,
                    'skipped': len(cids),
                    'message': 'All CIDs already exist in database',
                    'tag': tag,
                    'collection': collection_name
                })

        return jsonify({'message': 'No CID records found in the file'}), 204

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/start', methods=['POST'])
def start_processing():
    global worker_threads, should_stop, should_pause, active_workers, processing_active, current_collection_name
    
    if processing_active:
        return jsonify({'message': 'Processing is already running'}), 200
    
    try:
        # Get parameters from request
        data = request.get_json()
        num_workers = data.get('workers', 1)
        collection_name = data.get('collection', 'default_collection')
        
        num_workers = max(1, min(num_workers, 10))  # Limit between 1 and 10 workers
        
        should_stop = False
        should_pause = False
        processing_active = True
        active_workers = num_workers
        current_collection_name = collection_name
        
        # Clear any existing worker threads
        worker_threads = []
        
        # Start worker threads
        for i in range(num_workers):
            t = threading.Thread(target=worker_thread, args=(i+1, collection_name))
            t.start()
            worker_threads.append(t)
        
        return jsonify({
            'message': f'Processing started with {num_workers} workers on collection {collection_name}',
            'workers': num_workers,
            'collection': collection_name
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/pause', methods=['POST'])
def pause_processing():
    global should_pause
    
    if not processing_active:
        return jsonify({'message': 'No active processing to pause'}), 400
    
    should_pause = True
    return jsonify({'message': 'Pause requested'}), 200

@app.route('/resume', methods=['POST'])
def resume_processing():
    global should_pause
    
    if not should_pause:
        return jsonify({'message': 'Processing is not paused'}), 400
    
    should_pause = False
    return jsonify({'message': 'Resume requested'}), 200

@app.route('/stop', methods=['POST'])
def stop_processing():
    global should_stop, processing_active
    
    if not processing_active:
        return jsonify({'message': 'No active processing to stop'}), 400
    
    should_stop = True
    processing_active = False
    return jsonify({'message': 'Stop requested'}), 200

@app.route('/status', methods=['GET'])
def get_status():
    try:
        collection_name = request.args.get('collection', current_collection_name or 'default_collection')
        collection = get_collection(collection_name)
        
        total = collection.count_documents({})
        processed = collection.count_documents({'status': 'processed'})
        failed = collection.count_documents({'status': 'failed'})
        new = collection.count_documents({'status': 'new'})
        processing = collection.count_documents({'status': 'processing'})

        # Get all unique tags in the collection
        tags = collection.distinct('tag')

        return jsonify({
            'total': total,
            'processed': processed,
            'failed': failed,
            'new': new,
            'processing': processing,
            'processing_active': processing_active,
            'active_workers': active_workers,
            'paused': should_pause,
            'current_collection': collection_name,
            'tags': tags
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download', methods=['GET'])
def download_excel():
    try:
        tag_filter = request.args.get('tag')
        collection_name = request.args.get('collection', current_collection_name or 'default_collection')
        
        # Get the specified collection
        collection = get_collection(collection_name)
        
        # Build query based on tag filter
        query = {}
        if tag_filter and tag_filter != 'all':
            query['tag'] = tag_filter
            print(f"🔍 Downloading data for tag: {tag_filter} from collection: {collection_name}")
        
        # Get all documents with the required fields
        cursor = collection.find(query, {
            '_id': 0,
            'cid': 1,
            'status': 1,
            'April25': 1,
            'May25': 1,
            'June25': 1,
            'Highest': 1,
            'date_added': 1,
            'processed_date': 1,
            'error': 1,
            'tag': 1,
            'collection': 1
        })
        
        # Convert cursor to DataFrame
        df = pd.DataFrame(list(cursor))
        
        if df.empty:
            return jsonify({'error': 'No data to download for the selected collection and tag'}), 404

        # Convert date fields to string
        if 'date_added' in df.columns:
            df['date_added'] = pd.to_datetime(df['date_added']).dt.strftime('%Y-%m-%d %H:%M:%S')
        if 'processed_date' in df.columns:
            df['processed_date'] = pd.to_datetime(df['processed_date']).dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Reorder columns for better presentation
        column_order = [
            'cid', 'status', 'April25', 'May25', 'June25', 'Highest',
            'date_added', 'processed_date', 'error', 'tag', 'collection'
        ]
        
        # Add missing columns if they don't exist
        for col in column_order:
            if col not in df.columns:
                df[col] = None
        
        df = df[column_order]
        
        # Create temporary Excel file
        with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp_file:
            with pd.ExcelWriter(tmp_file.name, engine='openpyxl') as writer:
                df.to_excel(writer, index=False, sheet_name='Processed Data')
                
                # Format the Excel file
                workbook = writer.book
                worksheet = writer.sheets['Processed Data']
                
                # Format numeric columns
                number_format = '#,##0.00'
                for col in ['C', 'D', 'E', 'F']:  # C=April25, D=May25, E=June25, F=Highest
                    for cell in worksheet[col]:
                        try:
                            if cell.value is not None:
                                cell.number_format = number_format
                        except:
                            pass
                
                # Auto-adjust column widths
                for column in worksheet.columns:
                    max_length = 0
                    column_letter = column[0].column_letter
                    for cell in column:
                        try:
                            cell_value = str(cell.value) if cell.value is not None else ""
                            if len(cell_value) > max_length:
                                max_length = len(cell_value)
                        except:
                            pass
                    adjusted_width = min((max_length + 2), 50)  # Cap at 50 characters
                    worksheet.column_dimensions[column_letter].width = adjusted_width

            # Send the file
            return send_file(
                tmp_file.name,
                as_attachment=True,
                download_name=f'processed_data_{collection_name}_{tag_filter if tag_filter else "all"}.xlsx',
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )

    except Exception as e:
        return jsonify({'error': f"Failed to generate Excel file: {str(e)}"}), 500
    finally:
        try:
            os.unlink(tmp_file.name)
        except:
            pass

@app.route('/collections', methods=['GET'])
def list_collections():
    try:
        collections = db.list_collection_names()
        return jsonify({
            'collections': collections,
            'current_collection': current_collection_name
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/collections/<collection_name>', methods=['DELETE'])
def delete_collection(collection_name):
    try:
        if not collection_name:
            return jsonify({'error': 'Collection name is required'}), 400
        
        if collection_name == current_collection_name:
            return jsonify({'error': 'Cannot delete currently processing collection'}), 400
            
        db.drop_collection(collection_name)
        return jsonify({'message': f'Collection {collection_name} deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
 

if __name__ == '__main__':
    port = int(os.getenv('PORT', 10000))
    print(f"🚀 Flask Backend Running on http://0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)  # Set debug=False for production
