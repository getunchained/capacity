return n;
};

/** Gets the current month and year in "Mon YYYY" format */
const getCurrentMonthYear = () => {
    const now = new Date();
    // e.g., "Aug 2025"
    return now.toLocaleString('en-US', { month: 'short', year: 'numeric' });
};


// --- Google Sheet Configuration ---
// This is a public-facing ID for a sample sheet.
// To use your own data, replace this with your Google Sheet ID and ensure your sheet's
// sharing settings are "Anyone with the link can view".
const SPREADSHEET_ID = "1EJE7oAN2Tyb3RxW3XBYaoRj4bcyrPaJhhzzBDFDj5Nw";

// --- Main App Component ---
@@ -38,14 +49,14 @@ const App = () => {
const [namesData, setNamesData] = useState([]);
const [allocationsData, setAllocationsData] = useState([]);
const [totalAnnualBillableHours, setTotalAnnualBillableHours] = useState(2076); // Default value
  

// Loading and Error State
const [isLoading, setIsLoading] = useState(true);
const [isDataLoaded, setIsDataLoaded] = useState(false);
const [error, setError] = useState(null);

// Filters
  const [selectedMonth, setSelectedMonth] = useState('All');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthYear());
const [selectedDepartment, setSelectedDepartment] = useState('All');

// UI State
@@ -170,8 +181,8 @@ const App = () => {
filteredAllocations.forEach(alloc => {
const task = (alloc['Project (from Task)'] || '').toString().toUpperCase();

        // Per user request, do not include any hours from tasks with PTO or INT.
        if (task.includes('PTO') || task.includes('INT')) {
        // Per user request, do not include any hours from tasks with PTO or an exact match for INT.
        if (task.includes('PTO') || task === 'INT') {
return; // Skip this entire allocation record.
}

@@ -276,7 +287,7 @@ const App = () => {
const departmentsWithAllocations = new Set();
allocationsData.forEach(alloc => {
const task = (alloc['Project (from Task)'] || '').toString().toUpperCase();
        if (task.includes('PTO') || task.includes('INT')) {
        if (task.includes('PTO') || task === 'INT') {
return;
}
const normalizedResource = normalizeName(alloc.Resource);
@@ -334,6 +345,8 @@ const App = () => {

const handleExport = () => {
if (!sortedEmployees || sortedEmployees.length === 0) {
        // Using a custom modal or toast notification would be better than alert in a real app
        // but for simplicity, alert is used here.
alert("No data available to export.");
return;
}
@@ -375,6 +388,14 @@ const App = () => {
document.body.removeChild(link);
};

  const handleBarClick = (data) => {
    // The data payload can be null if clicking outside a bar
    if (data && data.activePayload && data.activePayload.length > 0) {
      const departmentName = data.activePayload[0].payload.name;
      setSelectedDepartment(departmentName);
    }
  };


// --- Render Functions & Components ---
const StatCard = ({ icon, title, value, subtext, color }) => (
@@ -390,6 +411,12 @@ const App = () => {

return (
<div className="bg-slate-100 min-h-screen p-4 md:p-8 font-sans text-slate-800">
      <style>{`
        .recharts-bar-rectangle:hover {
          cursor: pointer;
          opacity: 0.9;
        }
      `}</style>
<header className="mb-8 flex flex-wrap gap-4 justify-between items-center">
<div>
<h1 className="text-4xl font-bold text-slate-800">Capacity Planning Dashboard</h1>
@@ -456,7 +483,11 @@ const App = () => {
<h3 className="font-bold text-lg mb-4 text-slate-700">Department % to Target</h3>
<div className="w-full h-96">
<ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analysis.departments} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <BarChart 
                      data={analysis.departments} 
                      margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
                      onClick={handleBarClick}
                    >
<CartesianGrid strokeDasharray="3 3" vertical={false} />
<XAxis dataKey="name" tick={{ fill: '#64748b' }}/>
<YAxis unit="%" tick={{ fill: '#64748b' }} />
