1. What is the primary purpose of this wiki?

                                                                                                           
  This wiki is the team's persistent engineering memory. It captures the things the codebase can't show on
  its own:                                                                                                   
                                                         
  - Why decisions were taken — why Mongo over Postgres, why this stack, why this folder layout. Context,     
  options weighed, tradeoffs accepted.                   
  - How bugs were fixed — a playbook for every non-trivial bug, with symptom, root cause, fix, and detection.
   So the same bug doesn't get re-debugged in the next project, or six months from now when nobody remembers.
  - End-to-end feature flows — trigger, data path, components touched, edge cases. So a new dev gets a
  30-line overview instead of reading 500 lines of source.                                                   
                                                         
  The wiki grows continuously from multiple sources:                                                         
                                                         
  - Working sessions — after each session, anything important (a decision made, a bug solved, a clarification
   reached) is dropped into raw/.
  - Slack — threads that settle a decision, surface a bug fix, or explain tribal knowledge get distilled into
   raw/ so the reasoning isn't lost the moment the thread scrolls away.                                      
  - Linear — issues that close with non-obvious resolution context (root cause, design choice, follow-ups)
  get captured in raw/ so the why lives outside the ticket.                                                  
                                                         
  The LLM compiles raw/ into cross-linked wiki/ pages on ingest: existing pages are updated, contradictions  
  are flagged, and the synthesis compounds over time.    
                                                                                                             
  Goal: stop re-explaining the same things, stop re-debugging the same bugs, and stop losing the why when    
  threads scroll, tickets close, or people switch projects.
                                                                                                             
  ---                                                    
  Shorter (one-liner):
                      
  ▎ A persistent, LLM-compiled record of every decision, bug fix, and feature flow — distilled from working 
  ▎ sessions, Slack threads, and Linear issues — so we never re-debug, re-decide, or re-explain the same     
  ▎ thing twice
