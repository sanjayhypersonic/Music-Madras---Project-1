import React, { useState, useEffect } from 'react';
import { 
  Calendar, Mail, Phone, Music, MapPin, User, Info, CheckCircle, 
  Trash2, Shield, Radio, Sparkles, AlertCircle, Settings, LogIn, 
  LogOut, Check, ExternalLink, RefreshCw, Eye, FormInput, 
  ChevronDown, ChevronRight, HelpCircle
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import { BookingRequest } from '../types';
import { 
  initAuth, googleSignIn, logout, getAccessToken, createGoogleForm, 
  fetchFormResponses, FormQuestion, FormSubmission 
} from '../lib/googleForms';

interface BookingFormProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'booking' | 'inquire';
}

// Google Form Fields definitions
const BOOKING_QUESTIONS: FormQuestion[] = [
  { title: "Artist / Band Name", required: true, type: "TEXT" },
  { title: "Primary Instrument", required: true, type: "TEXT" },
  { title: "Contact Email", required: true, type: "TEXT" },
  { title: "Phone / WhatsApp", required: true, type: "TEXT" },
  {
    title: "Event Type",
    required: true,
    type: "CHOICE",
    choices: [
      "Concert / Fest Recital",
      "Church Music / Choral Service",
      "Private Solo Recital",
      "Practice/Studio Session",
      "Other"
    ]
  },
  { title: "Date of Event", required: true, type: "TEXT", description: "Format: YYYY-MM-DD" },
  { title: "Location in Chennai", required: true, type: "TEXT" },
  { title: "Sound Sample / Previous Clip URL", required: false, type: "TEXT" },
  { title: "Special Requests / Setup Details", required: false, type: "PARAGRAPH" }
];

const INQUIRY_QUESTIONS: FormQuestion[] = [
  { title: "Your Name", required: true, type: "TEXT" },
  { title: "Email Address", required: true, type: "TEXT" },
  { title: "Phone / WhatsApp", required: true, type: "TEXT" },
  { title: "Preferred Date", required: true, type: "TEXT", description: "Format: YYYY-MM-DD" },
  { title: "Alternative Date", required: false, type: "TEXT" },
  { title: "Venue / Event Location", required: true, type: "TEXT" },
  { title: "Message / Inquiry Details", required: true, type: "PARAGRAPH" }
];

interface InquiryRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredDate: string;
  alternativeDate?: string;
  venue: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function BookingForm({ isOpen, onClose, defaultMode = 'booking' }: BookingFormProps) {
  const [formMode, setFormMode] = useState<'booking' | 'inquire'>(defaultMode);
  const [showAdmin, setShowAdmin] = useState(false);
  const [useLocalFallback, setUseLocalFallback] = useState(false);

  // Local Booking Form State
  const [artistName, setArtistName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [instrument, setInstrument] = useState('');
  const [eventType, setEventType] = useState<'Concert' | 'Arangetram' | 'Recital' | 'Studio' | 'Other'>('Concert');
  const [eventDate, setEventDate] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [soundSampleUrl, setSoundSampleUrl] = useState('');
  const [message, setMessage] = useState('');
  const [myBookings, setMyBookings] = useState<BookingRequest[]>([]);

  // Local Inquiry Form State
  const [inquireName, setInquireName] = useState('');
  const [inquireEmail, setInquireEmail] = useState('');
  const [inquirePhone, setInquirePhone] = useState('');
  const [inquireDate, setInquireDate] = useState('');
  const [inquireAltDate, setInquireAltDate] = useState('');
  const [inquireVenue, setInquireVenue] = useState('');
  const [inquireMessage, setInquireMessage] = useState('');
  const [myInquiries, setMyInquiries] = useState<InquiryRequest[]>([]);

  // Google Forms Configuration State
  const [bookingFormId, setBookingFormId] = useState<string | null>(null);
  const [bookingFormUrl, setBookingFormUrl] = useState<string | null>(null);
  const [inquireFormId, setInquireFormId] = useState<string | null>(null);
  const [inquireFormUrl, setInquireFormUrl] = useState<string | null>(null);

  // Authentication and API dashboard State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [gToken, setGToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingForms, setIsCreatingForms] = useState(false);
  const [formResponses, setFormResponses] = useState<FormSubmission[]>([]);
  const [dashboardFormSelection, setDashboardFormSelection] = useState<'booking' | 'inquire'>('booking');
  const [responseError, setResponseError] = useState<string | null>(null);

  // Success and Error logs
  const [validationError, setValidationError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<string | null>(null);

  // Sync mode when defaultMode changes
  useEffect(() => {
    setFormMode(defaultMode);
  }, [defaultMode, isOpen]);

  // Load configs and local storage datasets
  useEffect(() => {
    // Local storages
    const savedBookings = localStorage.getItem('music_madras_bookings');
    if (savedBookings) {
      try { setMyBookings(JSON.parse(savedBookings)); } catch (e) { console.error(e); }
    }

    const savedInquiries = localStorage.getItem('music_madras_inquiries');
    if (savedInquiries) {
      try { setMyInquiries(JSON.parse(savedInquiries)); } catch (e) { console.error(e); }
    }

    // Google form variables
    setBookingFormId(localStorage.getItem('music_madras_gform_booking_id'));
    setBookingFormUrl(localStorage.getItem('music_madras_gform_booking_url'));
    setInquireFormId(localStorage.getItem('music_madras_gform_inquire_id'));
    setInquireFormUrl(localStorage.getItem('music_madras_gform_inquire_url'));

    // Initialize Firebase Auth
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setGToken(token);
      },
      () => {
        setUser(null);
        setGToken(null);
      }
    );

    return () => unsubscribe();
  }, [isOpen]);

  // Fetch responses if signed in and a form is selected
  useEffect(() => {
    if (showAdmin && user && gToken) {
      const activeId = dashboardFormSelection === 'booking' ? bookingFormId : inquireFormId;
      if (activeId) {
        loadSubmissions(activeId);
      } else {
        setFormResponses([]);
      }
    }
  }, [showAdmin, user, gToken, dashboardFormSelection, bookingFormId, inquireFormId]);

  const loadSubmissions = async (formId: string) => {
    if (!gToken) return;
    setIsLoading(true);
    setResponseError(null);
    try {
      const data = await fetchFormResponses(gToken, formId);
      setFormResponses(data.submissions);
    } catch (err: any) {
      console.error(err);
      setResponseError(err.message || 'Failed to fetch form submissions.');
    } finally {
      setIsLoading(false);
    }
  };

  // Google Sign-In trigger
  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setGToken(res.accessToken);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Logout trigger
  const handleGoogleLogout = async () => {
    setIsLoading(true);
    try {
      await logout();
      setUser(null);
      setGToken(null);
      setFormResponses([]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-create both forms programmatically
  const handleAutoCreateForms = async () => {
    if (!gToken) return;
    setIsCreatingForms(true);
    setValidationError('');
    try {
      // 1. Create Book Live Recording Form
      const bookingForm = await createGoogleForm(
        gToken,
        "Music Madras - Book Live Recording Form",
        BOOKING_QUESTIONS
      );
      localStorage.setItem('music_madras_gform_booking_id', bookingForm.formId);
      localStorage.setItem('music_madras_gform_booking_url', bookingForm.responderUri);
      setBookingFormId(bookingForm.formId);
      setBookingFormUrl(bookingForm.responderUri);

      // 2. Create Inquire About Your Date Form
      const inquiryForm = await createGoogleForm(
        gToken,
        "Music Madras - Inquire About Your Date Form",
        INQUIRY_QUESTIONS
      );
      localStorage.setItem('music_madras_gform_inquire_id', inquiryForm.formId);
      localStorage.setItem('music_madras_gform_inquire_url', inquiryForm.responderUri);
      setInquireFormId(inquiryForm.formId);
      setInquireFormUrl(inquiryForm.responderUri);

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch (err: any) {
      console.error(err);
      setValidationError(err.message || 'Failed to create Google Forms.');
    } finally {
      setIsCreatingForms(false);
    }
  };

  // Form Submissions (Fallback Local Database)
  const handleSubmitLocalBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistName || !email || !phone || !instrument || !eventDate || !eventLocation) {
      setValidationError('Please fill out all required fields.');
      return;
    }
    setValidationError('');

    const newBooking: BookingRequest = {
      id: `book-${Date.now()}`,
      artistName,
      email,
      phone,
      instrument,
      eventType,
      eventDate,
      eventLocation,
      packageType: 'Free Collaboration',
      soundSampleUrl: soundSampleUrl || undefined,
      message: message || undefined,
      status: 'Pending',
      createdAt: new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      })
    };

    const updated = [newBooking, ...myBookings];
    setMyBookings(updated);
    localStorage.setItem('music_madras_bookings', JSON.stringify(updated));

    // Reset Form
    setArtistName('');
    setEmail('');
    setPhone('');
    setInstrument('');
    setEventDate('');
    setEventLocation('');
    setSoundSampleUrl('');
    setMessage('');
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 4000);
  };

  const handleSubmitLocalInquiry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquireName || !inquireEmail || !inquirePhone || !inquireDate || !inquireVenue || !inquireMessage) {
      setValidationError('Please fill out all required fields.');
      return;
    }
    setValidationError('');

    const newInquiry: InquiryRequest = {
      id: `inq-${Date.now()}`,
      name: inquireName,
      email: inquireEmail,
      phone: inquirePhone,
      preferredDate: inquireDate,
      alternativeDate: inquireAltDate || undefined,
      venue: inquireVenue,
      message: inquireMessage,
      status: 'Pending',
      createdAt: new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      })
    };

    const updated = [newInquiry, ...myInquiries];
    setMyInquiries(updated);
    localStorage.setItem('music_madras_inquiries', JSON.stringify(updated));

    // Reset Form
    setInquireName('');
    setInquireEmail('');
    setInquirePhone('');
    setInquireDate('');
    setInquireAltDate('');
    setInquireVenue('');
    setInquireMessage('');
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 4000);
  };

  const handleDeleteBooking = (id: string) => {
    const updated = myBookings.filter(b => b.id !== id);
    setMyBookings(updated);
    localStorage.setItem('music_madras_bookings', JSON.stringify(updated));
  };

  const handleDeleteInquiry = (id: string) => {
    const updated = myInquiries.filter(i => i.id !== id);
    setMyInquiries(updated);
    localStorage.setItem('music_madras_inquiries', JSON.stringify(updated));
  };

  if (!isOpen) return null;

  const currentFormUrl = formMode === 'booking' ? bookingFormUrl : inquireFormUrl;
  const isGoogleFormActive = currentFormUrl && !useLocalFallback;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-zinc-900 w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 flex flex-col md:flex-row max-h-[92vh]">
        
        {/* Left Side: Lead Info */}
        <div className="md:w-4/12 bg-zinc-950 text-zinc-100 p-6 flex flex-col justify-between space-y-6 border-r border-zinc-800/80">
          <div className="space-y-4 text-left">
            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
              {formMode === 'booking' ? 'Artist Recording Portal' : 'Date Inquiry Center'}
            </span>
            <h3 className="font-serif text-2xl font-bold leading-tight text-zinc-50">
              {formMode === 'booking' ? 'Book Your 4K Archival Recording' : 'Secure Your Recital Date'}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {formMode === 'booking' 
                ? 'We bring professional small-diaphragm true condensers, pre-amps, and multi-cam 4K capture equipment directly to your performance spaces across Chennai.'
                : 'Confirm our team\'s availability for your cathedral choir or pipe organ recital. We advise coordinating at least 3 weeks before the live performance.'}
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex gap-2.5 items-start">
                <div className="p-1 rounded bg-zinc-900 mt-0.5 border border-zinc-850">
                  <CheckCircle className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-100">Google Forms Native</h4>
                  <p className="text-[10px] text-zinc-400 leading-normal">
                    This system connects seamlessly to active Google Forms, routing submissions directly into the site owner\'s secure personal Drive.
                  </p>
                </div>
              </div>

              <div className="flex gap-2.5 items-start">
                <div className="p-1 rounded bg-zinc-900 mt-0.5 border border-zinc-850">
                  <CheckCircle className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-100">Pristine Audio capture</h4>
                  <p className="text-[10px] text-zinc-400 leading-normal">
                    Equipped with premium Focusrite & Blackstar solid-state preamps to capture live instrument transients with pristine warmth.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 p-3 rounded-2xl flex gap-2 items-center text-[10px] text-zinc-400 leading-normal text-left">
            <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>Chennai live recording submissions are stored under the secure Google Workspace infrastructure.</span>
          </div>
        </div>

        {/* Right Side: Google Forms integration and public submissions forms */}
        <div className="md:w-8/12 flex flex-col overflow-hidden">
          
          {/* Header Bar inside modal */}
          <div className="bg-zinc-950 border-b border-zinc-800 p-3 flex flex-wrap justify-between items-center px-6 gap-3 flex-shrink-0">
            <div className="flex gap-3">
              <button
                onClick={() => { setShowAdmin(false); setFormMode('booking'); }}
                aria-label="Switch to Book Recording Form"
                aria-current={!showAdmin && formMode === 'booking' ? 'true' : 'false'}
                className={`text-xs font-extrabold uppercase tracking-wider pb-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1 ${
                  !showAdmin && formMode === 'booking'
                    ? 'border-b-2 border-amber-500 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Book Recording
              </button>
              <button
                onClick={() => { setShowAdmin(false); setFormMode('inquire'); }}
                aria-label="Switch to Inquire Date Form"
                aria-current={!showAdmin && formMode === 'inquire' ? 'true' : 'false'}
                className={`text-xs font-extrabold uppercase tracking-wider pb-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1 ${
                  !showAdmin && formMode === 'inquire'
                    ? 'border-b-2 border-amber-500 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Inquire Date
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAdmin(!showAdmin)}
                aria-label={showAdmin ? "Switch to Visitor View" : "Switch to Google Forms Admin View"}
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-full text-[10px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  showAdmin 
                    ? 'bg-amber-500 text-zinc-950 border-amber-400' 
                    : 'bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border-zinc-800'
                }`}
              >
                <Settings className={`w-3.5 h-3.5 ${showAdmin ? 'animate-spin' : ''}`} />
                {showAdmin ? "Visitor View" : "Google Forms Admin"}
              </button>

              <button
                onClick={onClose}
                aria-label="Close form modal"
                className="text-xs font-bold text-zinc-400 hover:text-zinc-100 transition-colors px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
              >
                Close
              </button>
            </div>
          </div>

          {/* Modal Container Content */}
          <div className="p-6 overflow-y-auto flex-grow flex flex-col">
            
            {/* Show error logs */}
            {validationError && (
              <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-2xl text-xs flex items-center gap-2 mb-4 flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {showSuccess && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-4 rounded-2xl text-xs space-y-1 mb-4 flex-shrink-0">
                <div className="font-bold flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle className="w-4 h-4" />
                  Successfully Configured Forms!
                </div>
                <p className="text-zinc-300">
                  Your Google Forms are now created and synced directly in your Google Drive. Live users will see your responsive Google Form embedding!
                </p>
              </div>
            )}

            {/* View A: Admin and Developer Google Forms Dashboard */}
            {showAdmin ? (
              <div className="space-y-6 text-left flex-grow">
                
                {/* 1. Google OAuth Card */}
                {!user ? (
                  <div className="bg-zinc-950 border border-zinc-800/80 p-8 rounded-2xl text-center space-y-5 max-w-lg mx-auto my-6">
                    <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto border border-amber-500/30">
                      <Settings className="w-6 h-6 text-amber-400" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="font-bold text-zinc-100 text-sm">Site Owner / Administrator Setup</h4>
                      <p className="text-xs text-zinc-400 leading-relaxed max-w-sm mx-auto">
                        Connect with your Google Account to automatically create, manage, and inspect submissions for the Bookings & Inquiry Google Forms.
                      </p>
                    </div>

                    <button
                      onClick={handleGoogleLogin}
                      disabled={isLoading}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-semibold text-zinc-100 rounded-xl transition-all cursor-pointer shadow"
                    >
                      <LogIn className="w-3.5 h-3.5 text-amber-500" />
                      {isLoading ? 'Verifying...' : 'Sign in with Google'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Logged in header details */}
                    <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-2xl flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center font-extrabold text-amber-400 font-serif">
                          {user.displayName ? user.displayName.charAt(0) : 'A'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-zinc-100">{user.displayName || 'Site Admin'}</p>
                          <p className="text-[10px] text-zinc-500 font-mono">{user.email}</p>
                        </div>
                      </div>

                      <button
                        onClick={handleGoogleLogout}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-rose-400 rounded-lg transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                      </button>
                    </div>

                    {/* Auto-Creation state and links config */}
                    {(!bookingFormId || !inquireFormId) ? (
                      <div className="bg-amber-500/5 border border-amber-500/15 p-6 rounded-2xl space-y-4">
                        <div className="flex items-start gap-3">
                          <Sparkles className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-zinc-100">Create & Map Forms Automatically</h5>
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                              With one click, we will create the "Book Live Recording" and "Inquire About Your Date" Google Forms inside your active Google Drive with correct input questions and map them automatically to your visitors.
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={handleAutoCreateForms}
                          disabled={isCreatingForms}
                          className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-800 text-zinc-950 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
                        >
                          {isCreatingForms ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Generating Forms in Google Drive...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Automate Google Forms Generation</span>
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Status Card 1 */}
                        <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-2xl space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider">Active Integration</span>
                              <h5 className="text-xs font-bold text-zinc-100 mt-1">Book Live Recording Form</h5>
                            </div>
                            <Check className="w-4 h-4 text-emerald-400 bg-emerald-500/15 p-0.5 rounded-full" />
                          </div>
                          <p className="text-[10px] text-zinc-400 leading-normal">
                            Google Form programmatically created and mapped to visitor portal dialog embeds.
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <a
                              href={`https://docs.google.com/forms/d/${bookingFormId}/edit`}
                              target="_blank"
                              referrerPolicy="no-referrer"
                              className="text-[10px] flex items-center gap-1 font-bold text-amber-500 hover:text-amber-400 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Edit in Google Forms
                            </a>
                          </div>
                        </div>

                        {/* Status Card 2 */}
                        <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-2xl space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider">Active Integration</span>
                              <h5 className="text-xs font-bold text-zinc-100 mt-1">Inquire About Your Date Form</h5>
                            </div>
                            <Check className="w-4 h-4 text-emerald-400 bg-emerald-500/15 p-0.5 rounded-full" />
                          </div>
                          <p className="text-[10px] text-zinc-400 leading-normal">
                            Google Form programmatically created and mapped to dates inquiries embed.
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <a
                              href={`https://docs.google.com/forms/d/${inquireFormId}/edit`}
                              target="_blank"
                              referrerPolicy="no-referrer"
                              className="text-[10px] flex items-center gap-1 font-bold text-amber-500 hover:text-amber-400 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Edit in Google Forms
                            </a>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Responses List Section */}
                    {(bookingFormId || inquireFormId) && (
                      <div className="space-y-4 pt-4 border-t border-zinc-800">
                        <div className="flex justify-between items-center flex-wrap gap-3">
                          <div>
                            <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider flex items-center gap-1.5">
                              <Radio className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                              Live Google Form Responses
                            </h4>
                            <p className="text-[10px] text-zinc-500">Real-time submissions fetched directly via Google API</p>
                          </div>

                          <div className="flex bg-zinc-950 border border-zinc-800 p-0.5 rounded-lg">
                            <button
                              onClick={() => setDashboardFormSelection('booking')}
                              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                                dashboardFormSelection === 'booking'
                                  ? 'bg-amber-500 text-zinc-950'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              Bookings
                            </button>
                            <button
                              onClick={() => setDashboardFormSelection('inquire')}
                              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                                dashboardFormSelection === 'inquire'
                                  ? 'bg-amber-500 text-zinc-950'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              Inquiries
                            </button>
                          </div>
                        </div>

                        {responseError && (
                          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-xl text-[11px] flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                            <span>{responseError}</span>
                          </div>
                        )}

                        {isLoading ? (
                          <div className="py-8 text-center flex flex-col items-center justify-center gap-2">
                            <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />
                            <p className="text-xs text-zinc-400 font-mono">Syncing form submissions with Google...</p>
                          </div>
                        ) : formResponses.length === 0 ? (
                          <div className="bg-zinc-950 border border-zinc-850 p-8 rounded-2xl text-center text-zinc-500 space-y-2">
                            <FormInput className="w-8 h-8 text-zinc-600 mx-auto" />
                            <p className="text-xs font-bold text-zinc-400">No Submissions Found</p>
                            <p className="text-[10px] text-zinc-500 max-w-xs mx-auto">There are no live responses for this Google Form yet. Share your form to gather records!</p>
                            <button 
                              onClick={() => {
                                const activeId = dashboardFormSelection === 'booking' ? bookingFormId : inquireFormId;
                                if (activeId) loadSubmissions(activeId);
                              }}
                              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-[10px] font-semibold text-zinc-300 rounded-lg border border-zinc-800 transition-colors inline-flex items-center gap-1 mt-2"
                            >
                              <RefreshCw className="w-3 h-3" /> Check Again
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex justify-between items-center text-[10px] text-zinc-500 px-1 font-mono">
                              <span>Total Submissions: {formResponses.length}</span>
                              <button 
                                onClick={() => {
                                  const activeId = dashboardFormSelection === 'booking' ? bookingFormId : inquireFormId;
                                  if (activeId) loadSubmissions(activeId);
                                }}
                                className="text-amber-500 hover:text-amber-400 flex items-center gap-1 font-bold"
                              >
                                <RefreshCw className="w-3 h-3" /> Sync Now
                              </button>
                            </div>

                            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                              {formResponses.map((sub) => {
                                const isExpanded = expandedSubmissionId === sub.responseId;
                                const primaryField = Object.keys(sub.answers)[0];
                                const secondaryField = Object.keys(sub.answers)[1];
                                
                                return (
                                  <div
                                    key={sub.responseId}
                                    className="bg-zinc-950 border border-zinc-850 rounded-xl overflow-hidden shadow-sm"
                                  >
                                    <div
                                      onClick={() => setExpandedSubmissionId(isExpanded ? null : sub.responseId)}
                                      className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-zinc-900/40 transition-colors"
                                    >
                                      <div>
                                        <p className="font-bold text-xs text-zinc-100">
                                          {sub.answers[primaryField] || 'Anonymous Submission'}
                                        </p>
                                        <p className="text-[10px] text-zinc-400 mt-0.5">
                                          {secondaryField && `${secondaryField}: ${sub.answers[secondaryField]}`}
                                        </p>
                                        <p className="text-[9px] text-zinc-500 font-mono mt-1">
                                          Submitted on {new Date(sub.createTime).toLocaleString()}
                                        </p>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <span className="text-[9px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/15">
                                          Google API
                                        </span>
                                        {isExpanded ? (
                                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                                        ) : (
                                          <ChevronRight className="w-4 h-4 text-zinc-500" />
                                        )}
                                      </div>
                                    </div>

                                    {isExpanded && (
                                      <div className="bg-zinc-900/40 border-t border-zinc-850 p-4 space-y-2.5 text-xs">
                                        {Object.entries(sub.answers).map(([qTitle, qAns]) => (
                                          <div key={qTitle} className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                                            <span className="text-zinc-500 font-bold text-[10px] uppercase tracking-wider">{qTitle}:</span>
                                            <span className="sm:col-span-2 text-zinc-200 font-medium leading-relaxed bg-zinc-950/80 px-2.5 py-1.5 rounded-lg border border-zinc-850">{qAns || <span className="text-zinc-600 italic">Not specified</span>}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                )}

              </div>
            ) : (
              // View B: Public Visitor view (renders Google Form embed or fallback local form)
              <div className="flex-grow flex flex-col justify-between">
                
                {isGoogleFormActive ? (
                  <div className="space-y-4 flex-grow flex flex-col h-full">
                    
                    {/* Embedded Form details header bar */}
                    <div className="flex justify-between items-center bg-zinc-950/50 border border-zinc-800 p-2.5 px-4 rounded-xl text-xs">
                      <span className="flex items-center gap-1.5 font-bold text-amber-400">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        Live Google Form Embedded
                      </span>

                      <button
                        onClick={() => setUseLocalFallback(true)}
                        className="text-[10px] font-bold text-zinc-400 hover:text-zinc-200 underline transition-all"
                      >
                        Use Traditional Form
                      </button>
                    </div>

                    {/* Form Embed View */}
                    <div className="flex-grow relative min-h-[460px] bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex items-center justify-center">
                      <iframe
                        src={`${currentFormUrl}?embedded=true`}
                        className="w-full h-full min-h-[460px] border-0 rounded-2xl"
                        title={formMode === 'booking' ? "Book Live Recording" : "Inquire Date"}
                      >
                        Loading Google Form...
                      </iframe>
                    </div>

                  </div>
                ) : (
                  // Traditional Fallback Forms
                  <div className="space-y-4 flex-grow text-left">
                    
                    {/* Fallback notice banner */}
                    {currentFormUrl && (
                      <div className="flex justify-between items-center bg-zinc-950/80 border border-zinc-850 p-2.5 px-4 rounded-xl text-xs mb-4">
                        <span className="flex items-center gap-1.5 text-zinc-400">
                          <HelpCircle className="w-3.5 h-3.5 text-zinc-500" />
                          Local Traditional Form (Alternative available)
                        </span>

                        <button
                          onClick={() => setUseLocalFallback(false)}
                          className="text-[10px] font-bold text-amber-500 hover:text-amber-400 font-semibold transition-all"
                        >
                          Switch back to Google Form
                        </button>
                      </div>
                    )}

                    {/* Case 1: Booking Form Mode */}
                    {formMode === 'booking' ? (
                      <form onSubmit={handleSubmitLocalBooking} className="space-y-4">
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Artist / Band Name *</label>
                            <div className="relative">
                              <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="text"
                                required
                                placeholder="e.g. Cathedral Chamber Choir"
                                value={artistName}
                                onChange={(e) => setArtistName(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Primary Instrument *</label>
                            <div className="relative">
                              <Music className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="text"
                                required
                                placeholder="e.g. Pipe Organ / Chamber Choir"
                                value={instrument}
                                onChange={(e) => setInstrument(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Contact Email *</label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="email"
                                required
                                placeholder="e.g. artist@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Phone / WhatsApp *</label>
                            <div className="relative">
                              <Phone className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="tel"
                                required
                                placeholder="e.g. +91 98765 43210"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Event Type *</label>
                            <select
                              value={eventType}
                              onChange={(e) => setEventType(e.target.value as any)}
                              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                            >
                              <option value="Concert">Concert / Fest Recital</option>
                              <option value="Arangetram">Church Music / Choral Service</option>
                              <option value="Recital">Private Solo Recital</option>
                              <option value="Studio">Practice/Studio Session</option>
                              <option value="Other">Other Significant Event</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Date of Event *</label>
                            <input
                              type="date"
                              required
                              value={eventDate}
                              onChange={(e) => setEventDate(e.target.value)}
                              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Location in Chennai *</label>
                            <div className="relative">
                              <MapPin className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="text"
                                required
                                placeholder="e.g. St. Andrew's Church (The Kirk)"
                                value={eventLocation}
                                onChange={(e) => setEventLocation(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Recording Package *</label>
                            <div className="w-full px-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-semibold text-amber-400">
                              Free Collaboration (Published on YouTube)
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Sound Sample / Previous Clip URL (Optional)</label>
                          <input
                            type="url"
                            placeholder="e.g. Link to drive sound snippet or performance"
                            value={soundSampleUrl}
                            onChange={(e) => setSoundSampleUrl(e.target.value)}
                            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Special Requests / Venue Details</label>
                          <textarea
                            rows={2}
                            placeholder="e.g. Tell us about the acoustics of the venue, mridangam spot..."
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                          />
                        </div>

                        <button
                          type="submit"
                          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          Submit Session Booking
                        </button>
                      </form>
                    ) : (
                      // Case 2: Inquiry Form Mode
                      <form onSubmit={handleSubmitLocalInquiry} className="space-y-4">
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Your Full Name *</label>
                            <div className="relative">
                              <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="text"
                                required
                                placeholder="e.g. Ramesh Sundar"
                                value={inquireName}
                                onChange={(e) => setInquireName(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Email Address *</label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="email"
                                required
                                placeholder="e.g. kalyan@example.com"
                                value={inquireEmail}
                                onChange={(e) => setInquireEmail(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Phone / WhatsApp *</label>
                            <div className="relative">
                              <Phone className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="tel"
                                required
                                placeholder="e.g. +91 94440 12345"
                                value={inquirePhone}
                                onChange={(e) => setInquirePhone(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Preferred Recital Date *</label>
                            <input
                              type="date"
                              required
                              value={inquireDate}
                              onChange={(e) => setInquireDate(e.target.value)}
                              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Alternative Dates (Optional)</label>
                            <input
                              type="text"
                              placeholder="e.g. Next weekend or Jan 15"
                              value={inquireAltDate}
                              onChange={(e) => setInquireAltDate(e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Venue / Event Location *</label>
                            <div className="relative">
                              <MapPin className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                              <input
                                type="text"
                                required
                                placeholder="e.g. Egmore Cathedral"
                                value={inquireVenue}
                                onChange={(e) => setInquireVenue(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Inquiry details / Message *</label>
                          <textarea
                            rows={3}
                            required
                            placeholder="Tell us about the choral performance, planned repertoire, duration..."
                            value={inquireMessage}
                            onChange={(e) => setInquireMessage(e.target.value)}
                            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                          />
                        </div>

                        <button
                          type="submit"
                          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          Submit Date Inquiry
                        </button>
                      </form>
                    )}

                    {/* Local submitted list logs for transparency */}
                    {formMode === 'booking' && myBookings.length > 0 && (
                      <div className="pt-5 border-t border-zinc-800 space-y-2.5">
                        <h4 className="text-[10px] font-extrabold text-zinc-100 uppercase tracking-wider flex items-center gap-1">
                          <Radio className="w-3 h-3 text-amber-500 animate-pulse" />
                          My Local Bookings ({myBookings.length})
                        </h4>
                        <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1">
                          {myBookings.map((b) => (
                            <div key={b.id} className="bg-zinc-950 border border-zinc-850 p-2.5 rounded-xl flex items-center justify-between text-[11px] gap-2">
                              <div>
                                <p className="font-bold text-zinc-100">{b.artistName} • {b.instrument}</p>
                                <p className="text-[9px] text-zinc-500">{b.eventType} on {b.eventDate} @ {b.eventLocation}</p>
                              </div>
                              <button onClick={() => handleDeleteBooking(b.id)} className="p-1 text-zinc-600 hover:text-red-400 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {formMode === 'inquire' && myInquiries.length > 0 && (
                      <div className="pt-5 border-t border-zinc-800 space-y-2.5">
                        <h4 className="text-[10px] font-extrabold text-zinc-100 uppercase tracking-wider flex items-center gap-1">
                          <Radio className="w-3 h-3 text-amber-500 animate-pulse" />
                          My Local Inquiries ({myInquiries.length})
                        </h4>
                        <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1">
                          {myInquiries.map((i) => (
                            <div key={i.id} className="bg-zinc-950 border border-zinc-850 p-2.5 rounded-xl flex items-center justify-between text-[11px] gap-2">
                              <div>
                                <p className="font-bold text-zinc-100">{i.name} • {i.preferredDate}</p>
                                <p className="text-[9px] text-zinc-500">Venue: {i.venue}</p>
                              </div>
                              <button onClick={() => handleDeleteInquiry(i.id)} className="p-1 text-zinc-600 hover:text-red-400 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
