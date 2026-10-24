# NexGen SmartRetail POS

> A modern, AI-powered Point of Sale and Business Intelligence system for retail businesses.

 NexGen SmartRetail POS is a full-stack retail management system designed to simplify billing, inventory management, sales tracking, expense management, and business analysis in one unified platform.

The system combines traditional POS functionality with analytics and AI-powered insights to help retailers understand their business and make better decisions.

---

##  Features

###  Smart Billing
- Fast and simple POS billing
- Product search and cart management
- Discounts and tax/GST support
- Multiple payment methods
- Due payment tracking
- Returns and bill adjustments
- Professional invoice generation
- Customer details and purchase history

###  Inventory Management
- Product and category management
- Stock quantity tracking
- Low-stock alerts
- Supplier management
- Purchase and stock tracking
- Inventory health monitoring

###  Business Intelligence
- Interactive sales dashboard
- Today's and historical sales
- Revenue and profit analysis
- Product performance
- Category performance
- Customer analysis
- Inventory insights
- Expense tracking
- Business performance comparisons

###  AI-Powered Features
- AI-assisted business insights
- Natural-language business queries
- AI-powered sales analysis
- Ollama integration for local AI
- Bill/document extraction support through the Bill AI workflow

###  Role-Based Access
- Admin and Employee roles
- Admin-only access to sensitive business information
- Employee-specific permissions
- Discount limits and controlled operations
- Employee directory with Present/Absent quick actions, a collapsible weekly/monthly Attendance page for attendance records and attendance settings, and a separate Salary page for payroll and salary adjustments; attendance can only be marked or changed for today
- Business profile details are editable from the Home page; general and appearance preferences are organized in separate Settings tabs
- Frequent products on New Sale can be shown or hidden, and filtered by category
- Login-aligned Home dashboard with live sales, stock, customer dues, recent activity, and quick alerts
- Home-matched daily Dashboard for today's performance, month-to-month financials, actionable alerts, and sales trends; Business Intelligence provides hourly/daily line-chart comparisons and deeper product, category, customer, and stock analysis
- Admin-only business data reset protected by password confirmation
- Guided first-run and post-reset business setup

###  Modern Interface
- Modern glassmorphism-inspired UI
- Dark and light visual experience
- Responsive dashboard
- Smooth interactions and animations
- Clean retail-focused workflow
- Electron-ready desktop environment

The guided setup page appears when creating the first admin account and after a
data reset. The reset permanently deletes business records and the admin
password, while preserving the shop profile, theme, appearance, and other
settings. It requires the current admin password and the exact confirmation
phrase `DELETE ALL DATA`; afterward, create a new admin password and finish the
setup page before opening the workspace.

---

## 🛠️ Technology Stack

### Frontend
- HTML5
- CSS3
- JavaScript

### Backend
- Node.js
- Express.js

### Database
- JSON-based local data storage
- MySQL support/integration

### AI
- Ollama
- Local LLM integration

### Desktop
- Electron

### Development
- VS Code
- Git & GitHub
- Node.js / npm

---

##  Project Structure

```text
pos-system/
│
├── data/                 # Local application data
│
├── electron/             # Electron desktop application
│
├── public/               # Frontend files
│   └── index.html
│
├── server/               # Backend and API
│   ├── services/         # External/AI services
│   └── ...
│
├── .env.example          # Environment variable template
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
