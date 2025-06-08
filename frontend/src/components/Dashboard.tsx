import React, { useState, useEffect } from 'react';
import { Upload, FileText, Settings, Play, Pause, RefreshCw, StopCircle, Download, Trash2 } from 'lucide-react';

const Dashboard = () => {
  const API_BASE_URL = 'http://localhost:9200';
  
  // State for form inputs
  const [tagInput, setTagInput] = useState('');
  const [collectionInput, setCollectionInput] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [workersInput, setWorkersInput] = useState(1);
  const [processingCollection, setProcessingCollection] = useState('');
  const [downloadCollection, setDownloadCollection] = useState('');
  const [downloadTag, setDownloadTag] = useState('all');
  
  // State for system data
  const [status, setStatus] = useState({
    processing_active: false,
    active_workers: 0,
    paused: false,
    current_collection: '',
    total: 0,
    processed: 0,
    failed: 0,
    new: 0,
    processing: 0,
    tags: []
  });
  
  const [collections, setCollections] = useState([]);
  const [responseMessages, setResponseMessages] = useState([]);
  const [isLoading, setIsLoading] = useState({
    upload: false,
    process: false,
    status: false
  });

  // Display response message
  const displayResponse = (message, isError = false) => {
    setResponseMessages(prev => [
      ...prev,
      { message, isError, timestamp: new Date().toISOString() }
    ]);
  };

  // Clear response messages
  const clearResponse = () => {
    setResponseMessages([]);
  };

  // Handle file selection
  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  // Upload file to server
  const uploadFile = async () => {
    clearResponse();
    
    if (!selectedFile) {
      displayResponse('Please select a file to upload', true);
      return;
    }
    if (!tagInput.trim()) {
      displayResponse('Please enter a tag for this batch', true);
      return;
    }
    if (!collectionInput.trim()) {
      displayResponse('Please enter a collection name', true);
      return;
    }

    setIsLoading(prev => ({ ...prev, upload: true }));

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('tag', tagInput.trim());
    formData.append('collection', collectionInput.trim());

    try {
      const res = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.error) {
        displayResponse(`Error: ${data.error}`, true);
      } else {
        displayResponse(`Success! Inserted ${data.inserted} records, skipped ${data.skipped} duplicates in "${data.collection}" with tag "${data.tag}"`);
        fetchCollections();
        checkStatus();
      }
    } catch (err) {
      displayResponse(`Upload failed: ${err.message}`, true);
    } finally {
      setIsLoading(prev => ({ ...prev, upload: false }));
    }
  };

  // Start processing
  const startProcessing = async () => {
    clearResponse();
    
    if (!processingCollection) {
      displayResponse('Please select a collection to process', true);
      return;
    }

    setIsLoading(prev => ({ ...prev, process: true }));

    try {
      const res = await fetch(`${API_BASE_URL}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workers: parseInt(workersInput), 
          collection: processingCollection 
        })
      });
      const data = await res.json();
      
      if (data.error) {
        displayResponse(`Error: ${data.error}`, true);
      } else {
        displayResponse(data.message);
        checkStatus();
      }
    } catch (err) {
      displayResponse(`Start failed: ${err.message}`, true);
    } finally {
      setIsLoading(prev => ({ ...prev, process: false }));
    }
  };

  // Control functions
  const pauseProcessing = async () => {
    clearResponse();
    try {
      const res = await fetch(`${API_BASE_URL}/pause`, { method: 'POST' });
      const data = await res.json();
      displayResponse(data.message);
      checkStatus();
    } catch (err) {
      displayResponse(`Pause failed: ${err.message}`, true);
    }
  };

  const resumeProcessing = async () => {
    clearResponse();
    try {
      const res = await fetch(`${API_BASE_URL}/resume`, { method: 'POST' });
      const data = await res.json();
      displayResponse(data.message);
      checkStatus();
    } catch (err) {
      displayResponse(`Resume failed: ${err.message}`, true);
    }
  };

  const stopProcessing = async () => {
    clearResponse();
    try {
      const res = await fetch(`${API_BASE_URL}/stop`, { method: 'POST' });
      const data = await res.json();
      displayResponse(data.message);
      checkStatus();
    } catch (err) {
      displayResponse(`Stop failed: ${err.message}`, true);
    }
  };

  // Download data
  const downloadData = () => {
    if (!downloadCollection) {
      displayResponse('Please select a collection to download', true);
      return;
    }
    if (!downloadTag) {
      displayResponse('Please select a tag to download', true);
      return;
    }
    
    window.open(
      `${API_BASE_URL}/download?tag=${downloadTag}&collection=${downloadCollection}`,
      '_blank'
    );
  };

  // Delete collection
  const deleteCollection = async (collectionName) => {
    if (!window.confirm(`Are you sure you want to delete collection "${collectionName}"? This cannot be undone.`)) {
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE_URL}/collections/${collectionName}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      
      if (data.error) {
        displayResponse(`Error: ${data.error}`, true);
      } else {
        displayResponse(data.message);
        fetchCollections();
        checkStatus();
      }
    } catch (err) {
      displayResponse(`Delete failed: ${err.message}`, true);
    }
  };

  // Check system status
  const checkStatus = async () => {
    setIsLoading(prev => ({ ...prev, status: true }));
    
    try {
      const res = await fetch(`${API_BASE_URL}/status`);
      const data = await res.json();
      
      if (data.error) {
        setStatus(prev => ({ ...prev, error: data.error }));
      } else {
        setStatus(data);
        updateCollectionSelects(data.current_collection);
      }
    } catch (err) {
      setStatus(prev => ({ ...prev, error: `Failed to get status: ${err.message}` }));
    } finally {
      setIsLoading(prev => ({ ...prev, status: false }));
    }
  };

  // Fetch collections
  const fetchCollections = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/collections`);
      const data = await res.json();
      
      if (data.error) {
        setCollections([]);
      } else {
        setCollections(data.collections || []);
        updateCollectionSelects(status.current_collection);
      }
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    }
  };

  // Update tag select options
  const updateTagSelect = async (collectionName) => {
    if (!collectionName) return;
    
    try {
      const res = await fetch(`${API_BASE_URL}/status?collection=${collectionName}`);
      const data = await res.json();
      
      if (data.tags) {
        setStatus(prev => ({ ...prev, tags: data.tags }));
      }
    } catch (err) {
      console.error('Failed to update tag select:', err);
    }
  };

  // Update collection selects
  const updateCollectionSelects = (currentCollection) => {
    if (collections.length > 0) {
      if (!processingCollection && currentCollection && collections.includes(currentCollection)) {
        setProcessingCollection(currentCollection);
      }
      if (!downloadCollection && currentCollection && collections.includes(currentCollection)) {
        setDownloadCollection(currentCollection);
        updateTagSelect(currentCollection);
      }
    }
  };

  // Initialize component
  useEffect(() => {
    checkStatus();
    fetchCollections();
  }, []);

  // Effect to update tag select when download collection changes
  useEffect(() => {
    if (downloadCollection) {
      updateTagSelect(downloadCollection);
    }
  }, [downloadCollection]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="flex items-center mb-4 md:mb-0">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl mr-4">
              <Upload className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">CID Processing System</h1>
              <p className="text-slate-300">Upload and process Excel files to generate CIDs</p>
            </div>
          </div>
          <button
            onClick={checkStatus}
            disabled={isLoading.status}
            className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-4 py-2 text-white transition-all duration-200 flex items-center space-x-2 disabled:opacity-50"
          >
            {isLoading.status ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>Refresh Status</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column */}
        <div className="space-y-8">
          {/* Upload Section */}
          <section className="bg-white/5 backdrop-blur-lg rounded-2xl shadow-xl border border-white/20 p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Upload Excel File
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-slate-300 mb-1">Batch Tag:</label>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Enter a tag for this batch"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Collection Name:</label>
                <input
                  type="text"
                  value={collectionInput}
                  onChange={(e) => setCollectionInput(e.target.value)}
                  placeholder="Enter collection name"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Excel File:</label>
                <div className="relative">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".xlsx,.xls"
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
                  />
                </div>
              </div>
              <button
                onClick={uploadFile}
                disabled={isLoading.upload}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                {isLoading.upload ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>Upload</span>
                    <Upload className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Response Section */}
          <section className="bg-white/5 backdrop-blur-lg rounded-2xl shadow-xl border border-white/20 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Response</h2>
            <div className="bg-white/5 border border-white/20 rounded-xl p-4 h-64 overflow-y-auto">
              {responseMessages.length === 0 ? (
                <p className="text-slate-400 italic">No messages yet</p>
              ) : (
                responseMessages.map((msg, index) => (
                  <p 
                    key={index} 
                    className={`mb-2 last:mb-0 ${msg.isError ? 'text-red-400' : 'text-green-400'}`}
                  >
                    [{new Date(msg.timestamp).toLocaleTimeString()}] {msg.message}
                  </p>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          {/* Processing Settings */}
          <section className="bg-white/5 backdrop-blur-lg rounded-2xl shadow-xl border border-white/20 p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
              <Settings className="w-5 h-5 mr-2" />
              Processing Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-slate-300 mb-1">Collection to Process:</label>
                <select
                  value={processingCollection}
                  onChange={(e) => setProcessingCollection(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                >
                  <option value="">Select a collection</option>
                  {collections.map(collection => (
                    <option key={collection} value={collection}>{collection}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Number of Workers (1-10):</label>
                <input
                  type="number"
                  value={workersInput}
                  onChange={(e) => setWorkersInput(e.target.value)}
                  min="1"
                  max="10"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={startProcessing}
                  disabled={isLoading.process}
                  className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {isLoading.process ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Start</span>
                    </>
                  )}
                </button>
                <button
                  onClick={pauseProcessing}
                  disabled={!status.processing_active || status.paused}
                  className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  <Pause className="w-4 h-4" />
                  <span>Pause</span>
                </button>
                <button
                  onClick={resumeProcessing}
                  disabled={!status.processing_active || !status.paused}
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Resume</span>
                </button>
                <button
                  onClick={stopProcessing}
                  disabled={!status.processing_active}
                  className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  <StopCircle className="w-4 h-4" />
                  <span>Stop</span>
                </button>
              </div>
              <div className="pt-4 border-t border-white/10">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 mb-1">Download Collection:</label>
                    <select
                      value={downloadCollection}
                      onChange={(e) => setDownloadCollection(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select a collection</option>
                      {collections.map(collection => (
                        <option key={`dl-${collection}`} value={collection}>{collection}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Download by Tag:</label>
                    <select
                      value={downloadTag}
                      onChange={(e) => setDownloadTag(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="all">All Tags</option>
                      {status.tags.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={downloadData}
                  disabled={!downloadCollection}
                  className="w-full mt-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-xl px-4 py-3 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
              </div>
            </div>
          </section>

          {/* System Status */}
          <section className="bg-white/5 backdrop-blur-lg rounded-2xl shadow-xl border border-white/20 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">System Status</h2>
            <div className="bg-white/5 border border-white/20 rounded-xl p-4 mb-4">
              {status.error ? (
                <p className="text-red-400">{status.error}</p>
              ) : (
                <div className="space-y-2">
                  <p><strong className="text-white">Processing Status:</strong> <span className={status.processing_active ? 'text-green-400' : 'text-red-400'}>{status.processing_active ? 'Active' : 'Inactive'}</span></p>
                  <p><strong className="text-white">Active Workers:</strong> <span className="text-blue-400">{status.active_workers}</span></p>
                  <p><strong className="text-white">Paused:</strong> <span className={status.paused ? 'text-yellow-400' : 'text-green-400'}>{status.paused ? 'Yes' : 'No'}</span></p>
                  <p><strong className="text-white">Current Collection:</strong> <span className="text-purple-400">{status.current_collection || 'None'}</span></p>
                  <p><strong className="text-white">Records:</strong> Total=<span className="text-blue-400">{status.total}</span>, Processed=<span className="text-green-400">{status.processed}</span>, Failed=<span className="text-red-400">{status.failed}</span>, New=<span className="text-yellow-400">{status.new}</span>, Processing=<span className="text-purple-400">{status.processing}</span></p>
                </div>
              )}
            </div>
            
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-white mb-2">Available Tags:</h3>
              {status.tags && status.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {status.tags.map(tag => (
                    <span key={tag} className="bg-white/10 text-white px-3 py-1 rounded-full text-sm">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 italic">No tags available</p>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Available Collections - Full width at bottom */}
      <section className="max-w-7xl mx-auto mt-8 bg-white/5 backdrop-blur-lg rounded-2xl shadow-xl border border-white/20 p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Available Collections</h2>
        {collections.length > 0 ? (
          <div className="bg-white/5 border border-white/20 rounded-xl overflow-hidden">
            {collections.map(collection => (
              <div 
                key={`col-${collection}`} 
                className="border-b border-white/10 last:border-b-0 p-3 flex justify-between items-center"
              >
                <span className={`text-white ${collection === status.current_collection ? 'font-bold' : ''}`}>
                  {collection}
                  {collection === status.current_collection && ' (currently processing)'}
                </span>
                <button
                  onClick={() => deleteCollection(collection)}
                  className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 hover:text-red-300 rounded-lg px-3 py-1 text-sm transition-all duration-200 flex items-center space-x-1"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 italic">No collections available</p>
        )}
      </section>
    </div>
  );
};

export default Dashboard;