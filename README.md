# BlisterSynth AI

**AI-Powered Synthetic Industrial Data Generation & Predictive Maintenance Platform**

BlisterSynth AI is a full-stack application designed to generate realistic synthetic industrial sensor data, simulate equipment degradation, inject faults, and evaluate predictive maintenance scenarios.

It combines machine learning, configurable simulation, and an AI-powered scenario assistant to help users explore industrial equipment behavior without requiring access to expensive or sensitive real-world datasets.

---

## 🚀 Features

### 1. Synthetic Data Generation
- Generate configurable industrial time-series sensor data.
- Simulate equipment operating conditions.
- Generate datasets with customizable durations and parameters.
- Support for machine learning-based synthetic data generation.

### 2. Machine Learning Models
- **cVAE (Conditional Variational Autoencoder):** Generate synthetic data based on specified conditions.
- **TimeGAN:** Model realistic temporal patterns in time-series data.
- **Scikit-learn:** Support for data processing and model evaluation.

### 3. Fault Injection & Simulation
- Simulate equipment degradation scenarios.
- Inject configurable faults into generated datasets.
- Control fault onset, duration, and severity.
- Explore how equipment sensor readings change under different operating conditions.

### 4. AI Scenario Copilot
Describe a simulation in natural language instead of manually configuring every parameter.

Example:

> Generate 2 hours of data with bearing wear starting at minute 40, high severity.

The Copilot translates natural-language instructions into structured simulation configurations.

- Anthropic Claude API integration.
- Rule-based fallback parser when Claude is unavailable.
- Configuration validation before simulation.

### 5. Predictive Maintenance Evaluation
- Analyze generated sensor data.
- Evaluate simulated fault scenarios.
- Explore equipment degradation patterns.
- Support experimentation with predictive maintenance workflows.

### 6. Web Dashboard
- React-based user interface.
- Interactive simulation configuration.
- Data generation and evaluation workflows.
- Dataset visualization and export.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Python, FastAPI |
| Machine Learning | PyTorch, Scikit-learn |
| Generative Models | cVAE, TimeGAN |
| AI Integration | Anthropic Claude API |
| Data Processing | NumPy, Pandas |
| Database | SQLite |
| Deployment | Docker, Render |

---

## 🏗️ Architecture

```text
                  ┌──────────────────────┐
                  │      React UI        │
                  │   TypeScript + Vite  │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    FastAPI Backend   │
                  │   REST API Services  │
                  └──────────┬───────────┘
                             │
             ┌───────────────┼────────────────┐
             │               │                │
             ▼               ▼                ▼
      ┌────────────┐  ┌─────────────┐  ┌──────────────┐
      │ Synthetic  │  │ Fault       │  │ AI Scenario  │
      │ Generation │  │ Injection   │  │ Copilot      │
      └─────┬──────┘  └──────┬──────┘  └──────┬───────┘
            │                │                │
            └────────────────┼────────────────┘
                             ▼
                  ┌──────────────────────┐
                  │ Dataset & Evaluation │
                  │      Pipeline        │
                  └──────────────────────┘
```

---

## ⚙️ Getting Started

### Prerequisites

- Python 3.10+
- Node.js and npm
- Git
- Docker (optional)

### 1. Clone the repository

```bash
git clone https://github.com/likhitareddy09/BlisterSynth-AI.git
cd BlisterSynth-AI
```

### 2. Backend Setup

```bash
cd backend

python -m venv venv
```

Activate the virtual environment:

**Windows:**
```powershell
venv\Scripts\activate
```

**Linux / macOS:**
```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the backend:

```bash
uvicorn app.main:app --reload
```

Backend API:

```text
http://localhost:8000
```

API documentation:

```text
http://localhost:8000/docs
```

### 3. Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local frontend URL displayed by Vite, usually:

```text
http://localhost:5173
```

---

## 🔑 Environment Variables

Create a `.env` file in the backend directory if you want to enable Anthropic Claude integration.

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=your_supported_anthropic_model
```

**Important:**
- Claude API access requires an Anthropic Console API key.
- A Claude web subscription does not automatically provide API access.
- The AI Copilot includes a rule-based fallback when Claude is unavailable.
- Never commit API keys or `.env` files to GitHub.

---

## 🌐 Live Deployment

**Live Application:**  
https://blistersynth-ai.onrender.com

**API Documentation:**  
https://blistersynth-ai.onrender.com/docs

**Health Check:**  
https://blistersynth-ai.onrender.com/api/health

The application is deployed using Docker on Render.

*Note: The free hosting environment may spin down after inactivity. Local generated data may not persist across restarts or redeployments.*

---

## 📁 Project Structure

```text
BlisterSynth-AI/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── main.py
│   │   ├── copilot.py
│   │   └── config.py
│   ├── requirements.txt
│   └── ...
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── Dockerfile
├── .gitignore
└── README.md
```

---

## 🎯 Use Cases

- Industrial equipment degradation simulation.
- Synthetic time-series dataset generation.
- Predictive maintenance experimentation.
- Machine learning model development and testing.
- Fault detection workflow prototyping.
- Industrial IoT data experimentation.

---

## 🔮 Future Improvements

- More industrial equipment simulation profiles.
- Additional fault types and degradation models.
- Advanced predictive maintenance algorithms.
- Improved dataset analytics and visualization.
- Persistent cloud storage.
- User authentication and access management.
- Expanded AI-assisted simulation capabilities.

---

## ⚠️ Limitations

- Synthetic datasets are simulated and should not be treated as actual industrial measurements.
- Model performance depends on training data, configuration, and implementation.
- Claude-powered features require separate Anthropic API access.
- Free-tier hosting has resource and persistence limitations.
- The application is currently intended for experimentation and prototyping, not safety-critical industrial deployment.

---

## 👨‍💻 Project

**BlisterSynth AI**  
AI-powered synthetic industrial data generation and predictive maintenance experimentation.

**Repository:** https://github.com/likhitareddy09/BlisterSynth-AI  
**Live Demo:** https://blistersynth-ai.onrender.com

---

*Built to explore the intersection of generative AI, machine learning, industrial simulation, and predictive maintenance.*
