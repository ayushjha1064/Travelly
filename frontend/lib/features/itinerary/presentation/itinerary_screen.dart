import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/api/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../data/itinerary_service.dart';

class ItineraryScreen extends StatefulWidget {
  final String tripId, destination, dateRange, currency;
  final ItineraryService service;
  const ItineraryScreen({
    super.key,
    required this.tripId,
    required this.destination,
    required this.dateRange,
    required this.currency,
    required this.service,
  });

  @override
  State<ItineraryScreen> createState() => _ItineraryScreenState();
}

class _ItineraryScreenState extends State<ItineraryScreen> {
  final _form = GlobalKey<FormState>();
  final _budget = TextEditingController();
  final _interests = TextEditingController();
  SavedItinerary? _saved;
  bool _loading = true, _generating = false, _loadFailed = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _budget.dispose();
    _interests.dispose();
    super.dispose();
  }

  String _message(Object error) {
    if (error is ApiException) return error.message;
    if (error is TimeoutException) {
      return 'The request timed out. Reopen this screen to check whether it was saved, or retry.';
    }
    return 'Unable to load the itinerary. Please try again.';
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _loadFailed = false;
    });
    try {
      final saved = await widget.service.load(widget.tripId);
      if (!mounted) return;
      setState(() {
        _saved = saved;
        _budget.text = saved?.budget?.toString() ?? '';
        _interests.text = saved?.interests ?? '';
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = _message(error);
          _loadFailed = true;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _generate() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final saved = await widget.service.generate(
        widget.tripId,
        budget: double.tryParse(_budget.text.trim()),
        interests: _interests.text.trim(),
      );
      if (mounted) setState(() => _saved = saved);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final saved = _saved;
    return Scaffold(
      appBar: AppBar(title: const Text('AI Itinerary')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  widget.destination,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(widget.dateRange),
                const SizedBox(height: 16),
                const Text(
                  'Uses your trip dates, destination and group size. The latest generated itinerary is saved for everyone in this trip.',
                ),
                const SizedBox(height: 16),
                Form(
                  key: _form,
                  child: Column(
                    children: [
                      TextFormField(
                        controller: _budget,
                        enabled: !_generating && !_loadFailed,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText:
                              'Group activity budget (${widget.currency}, optional)',
                          helperText:
                              'Meals, activities and local transport for all days.\nExcludes accommodation and travel to/from destination.',
                          helperMaxLines: 3,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return null;
                          }
                          final amount = double.tryParse(value.trim());
                          return amount == null ||
                                  !amount.isFinite ||
                                  amount <= 0 ||
                                  amount > 100000000
                              ? 'Enter an amount between 0 and 100000000 (exclusive of 0).'
                              : null;
                        },
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _interests,
                        enabled: !_generating && !_loadFailed,
                        maxLength: 500,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          labelText: 'Interests and preferences (optional)',
                          hintText: 'Beaches, local food, relaxed mornings...',
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.primaryBlue,
                            foregroundColor: Colors.white,
                          ),
                          onPressed: _generating || _loadFailed
                              ? null
                              : _generate,
                          icon: _generating
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.auto_awesome),
                          label: Text(
                            _generating
                                ? 'Generating itinerary...'
                                : saved == null
                                ? 'Generate AI Itinerary'
                                : 'Regenerate AI Itinerary',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: const TextStyle(color: AppTheme.redAccent),
                  ),
                  TextButton(
                    onPressed: _generating
                        ? null
                        : _loadFailed
                        ? _load
                        : _generate,
                    child: const Text('Retry'),
                  ),
                ],
                if (saved != null) ...[
                  const SizedBox(height: 20),
                  if (saved.stale)
                    const Text(
                      'Your trip details have changed. Regenerate to use the latest dates, destination and travelers.',
                      style: TextStyle(color: AppTheme.redAccent),
                    ),
                  Text(
                    saved.summary,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Estimated group total: ${saved.currency} ${saved.estimatedTotalCost.toStringAsFixed(2)}',
                  ),
                  const Text(
                    'AI suggestions and costs are estimates. Check opening hours, availability and prices before booking.',
                  ),
                  const SizedBox(height: 12),
                  for (final day in saved.days)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Day ${day.day} · ${day.date}',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            for (final activity in day.activities)
                              Padding(
                                padding: const EdgeInsets.only(top: 16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${activity.time} · ${activity.title}',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    Text(activity.description),
                                    Text(
                                      '${saved.currency} ${activity.estimatedCost.toStringAsFixed(2)} for the group',
                                      style: const TextStyle(
                                        color: AppTheme.greyText,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
              ],
            ),
    );
  }
}
